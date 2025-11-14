from typing import Optional, Dict, Any
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, case, cast, Float, extract
from pydantic import BaseModel

from src.db.database import get_session
from src.db.models import User, Item
from src.auth.dependencies import get_current_user
from src.utils.response import success_response, error_response
from src.utils.datetime_utils import calculate_daily_cost, get_days_since

router = APIRouter(prefix="/api/stats", tags=["统计数据"])


class OverviewStats(BaseModel):
    """总览统计数据"""
    total_items: int = 0
    total_cost: float = 0.0
    total_daily_cost: float = 0.0
    average_daily_cost: float = 0.0
    most_expensive_item: Optional[Dict[str, Any]] = None
    latest_item: Optional[Dict[str, Any]] = None
    longest_used_item: Optional[Dict[str, Any]] = None


class MonthlyStats(BaseModel):
    """月度统计数据"""
    month: str
    items_added: int = 0
    total_spent: float = 0.0
    daily_cost_change: float = 0.0


class CategoryStats(BaseModel):
    """分类统计（预留）"""
    category: str
    item_count: int = 0
    total_cost: float = 0.0
    average_cost: float = 0.0


@router.get("/overview", summary="获取总览统计数据")
async def get_overview_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session)
):
    """
    获取用户的总览统计数据
    """
    try:
        # 基础统计
        base_conditions = [
            Item.user_id == current_user.id,
            Item.is_delete == False
        ]

        # 总物品数
        total_items_stmt = select(func.count(Item.id)).where(and_(*base_conditions))
        total_items_result = await db.execute(total_items_stmt)
        total_items = total_items_result.scalar() or 0

        # 总成本
        total_cost_stmt = select(func.sum(Item.purchase_amount)).where(and_(*base_conditions))
        total_cost_result = await db.execute(total_cost_stmt)
        total_cost = float(total_cost_result.scalar() or 0)

        # 计算总日均成本
        items_stmt = select(Item).where(and_(*base_conditions))
        items_result = await db.execute(items_stmt)
        items = items_result.scalars().all()

        total_daily_cost = 0.0
        most_expensive_item = None
        latest_item = None
        longest_used_item = None

        for item in items:
            daily_cost = calculate_daily_cost(item.purchase_amount, item.purchase_date)
            total_daily_cost += daily_cost

            # 最贵物品
            if most_expensive_item is None or item.purchase_amount > most_expensive_item["purchase_amount"]:
                most_expensive_item = {
                    "id": item.id,
                    "name": item.name,
                    "purchase_amount": float(item.purchase_amount),
                    "purchase_date": item.purchase_date.isoformat(),
                    "daily_cost": daily_cost
                }

            # 最新物品
            if latest_item is None or item.created_at > latest_item["created_at"]:
                latest_item = {
                    "id": item.id,
                    "name": item.name,
                    "purchase_amount": float(item.purchase_amount),
                    "purchase_date": item.purchase_date.isoformat(),
                    "created_at": item.created_at.isoformat()
                }

            # 使用最久的物品
            days_used = get_days_since(item.purchase_date)
            if longest_used_item is None or days_used > longest_used_item["days_used"]:
                longest_used_item = {
                    "id": item.id,
                    "name": item.name,
                    "days_used": days_used,
                    "purchase_date": item.purchase_date.isoformat(),
                    "daily_cost": daily_cost
                }

        # 平均日均成本
        average_daily_cost = total_daily_cost / total_items if total_items > 0 else 0

        overview_data = {
            "total_items": total_items,
            "total_cost": round(total_cost, 2),
            "total_daily_cost": round(total_daily_cost, 4),
            "average_daily_cost": round(average_daily_cost, 4),
            "most_expensive_item": most_expensive_item,
            "latest_item": latest_item,
            "longest_used_item": longest_used_item
        }

        return success_response(overview_data, "获取总览统计成功")

    except Exception as e:
        return error_response(f"获取总览统计失败: {str(e)}", "OVERVIEW_STATS_ERROR")


@router.get("/trends", summary="获取成本趋势数据")
async def get_cost_trends(
    months: int = Query(12, ge=1, le=24, description="查询月数"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session)
):
    """
    获取成本趋势数据
    """
    try:
        # 计算日期范围
        end_date = datetime.now()
        start_date = end_date - timedelta(days=months * 30)

        base_conditions = [
            Item.user_id == current_user.id,
            Item.is_delete == False,
            Item.purchase_date >= start_date.date(),
            Item.purchase_date <= end_date.date()
        ]

        # 按月统计
        monthly_stats = []

        for i in range(months):
            # 计算月份
            month_date = end_date - timedelta(days=i * 30)
            month_start = month_date.replace(day=1).date()

            # 获取该月的数据
            month_conditions = base_conditions + [
                extract('year', Item.purchase_date) == month_start.year,
                extract('month', Item.purchase_date) == month_start.month
            ]

            # 该月新增物品数
            items_count_stmt = select(func.count(Item.id)).where(and_(*month_conditions))
            items_count_result = await db.execute(items_count_stmt)
            items_count = items_count_result.scalar() or 0

            # 该月总支出
            total_spent_stmt = select(func.sum(Item.purchase_amount)).where(and_(*month_conditions))
            total_spent_result = await db.execute(total_spent_stmt)
            total_spent = float(total_spent_result.scalar() or 0)

            monthly_stats.append({
                "month": month_start.strftime("%Y-%m"),
                "items_added": items_count,
                "total_spent": round(total_spent, 2)
            })

        # 反转列表，使最近月份在前
        monthly_stats.reverse()

        # 计算累计成本趋势
        cumulative_cost = 0
        for stat in monthly_stats:
            cumulative_cost += stat["total_spent"]
            stat["cumulative_cost"] = round(cumulative_cost, 2)

        return success_response({
            "monthly_stats": monthly_stats,
            "period": f"{(end_date - timedelta(days=months * 30)).strftime('%Y-%m')} 到 {end_date.strftime('%Y-%m')}"
        }, "获取成本趋势成功")

    except Exception as e:
        return error_response(f"获取成本趋势失败: {str(e)}", "TRENDS_STATS_ERROR")


@router.get("/monthly", summary="获取月度详细统计")
async def get_monthly_stats(
    year: Optional[int] = Query(None, ge=2020, le=2030, description="年份，默认为当年"),
    month: Optional[int] = Query(None, ge=1, le=12, description="月份，默认为当月"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session)
):
    """
    获取指定月份的详细统计数据
    """
    try:
        today = datetime.now()
        target_year = year or today.year
        target_month = month or today.month

        # 构建查询条件
        base_conditions = [
            Item.user_id == current_user.id,
            Item.is_delete == False,
            extract('year', Item.purchase_date) == target_year,
            extract('month', Item.purchase_date) == target_month
        ]

        # 该月物品列表
        items_stmt = select(Item).where(and_(*base_conditions)).order_by(Item.purchase_date.desc())
        items_result = await db.execute(items_stmt)
        items = items_result.scalars().all()

        # 统计数据
        items_list = []
        total_cost = 0
        total_daily_cost = 0

        for item in items:
            daily_cost = calculate_daily_cost(item.purchase_amount, item.purchase_date)
            days_used = get_days_since(item.purchase_date)
            total_cost += item.purchase_amount
            total_daily_cost += daily_cost

            items_list.append({
                "id": item.id,
                "name": item.name,
                "purchase_date": item.purchase_date.isoformat(),
                "purchase_amount": float(item.purchase_amount),
                "daily_cost": daily_cost,
                "days_used": days_used
            })

        monthly_data = {
            "year": target_year,
            "month": target_month,
            "total_items": len(items),
            "total_cost": round(total_cost, 2),
            "total_daily_cost": round(total_daily_cost, 4),
            "average_item_cost": round(total_cost / len(items), 2) if items else 0,
            "average_daily_cost": round(total_daily_cost / len(items), 4) if items else 0,
            "items": items_list
        }

        return success_response(monthly_data, "获取月度统计成功")

    except Exception as e:
        return error_response(f"获取月度统计失败: {str(e)}", "MONTHLY_STATS_ERROR")


@router.get("/category", summary="获取分类统计（预留功能）")
async def get_category_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session)
):
    """
    获取分类统计数据（预留功能，当前返回模拟数据）
    """
    try:
        # 这里可以实现按类别统计的逻辑
        # 当前返回模拟数据作为示例

        mock_categories = [
            {
                "category": "电子产品",
                "item_count": 5,
                "total_cost": 15888.50,
                "average_cost": 3177.70
            },
            {
                "category": "服装",
                "item_count": 12,
                "total_cost": 3650.00,
                "average_cost": 304.17
            },
            {
                "category": "书籍",
                "item_count": 8,
                "total_cost": 456.80,
                "average_cost": 57.10
            },
            {
                "category": "其他",
                "item_count": 15,
                "total_cost": 2345.60,
                "average_cost": 156.37
            }
        ]

        return success_response(mock_categories, "获取分类统计成功")

    except Exception as e:
        return error_response(f"获取分类统计失败: {str(e)}", "CATEGORY_STATS_ERROR")


@router.get("/dashboard", summary="获取仪表板数据")
async def get_dashboard_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session)
):
    """
    获取仪表板所需的所有统计数据
    """
    try:
        # 获取总览统计
        overview_response = await get_overview_stats(current_user, db)
        if not overview_response.get("success", False):
            return overview_response

        # 获取最近6个月的趋势
        trends_response = await get_cost_trends(6, current_user, db)
        if not trends_response.get("success", False):
            return trends_response

        # 获取当月统计
        monthly_response = await get_monthly_stats(None, None, current_user, db)
        if not monthly_response.get("success", False):
            return monthly_response

        dashboard_data = {
            "overview": overview_response["data"],
            "trends": trends_response["data"],
            "current_month": monthly_response["data"],
            "quick_stats": {
                "items_this_month": monthly_response["data"]["total_items"],
                "spent_this_month": monthly_response["data"]["total_cost"],
                "total_items": overview_response["data"]["total_items"],
                "total_cost": overview_response["data"]["total_cost"]
            }
        }

        return success_response(dashboard_data, "获取仪表板数据成功")

    except Exception as e:
        return error_response(f"获取仪表板数据失败: {str(e)}", "DASHBOARD_STATS_ERROR")