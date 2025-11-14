from typing import Optional
from datetime import date
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, desc
from pydantic import BaseModel, Field, validator

from src.db.database import get_session
from src.db.models import User, Item
from src.auth.dependencies import get_current_user
from src.utils.response import success_response, error_response, paginated_response
from src.utils.datetime_utils import calculate_daily_cost, format_date, parse_date, get_days_since

router = APIRouter(prefix="/api/items", tags=["物品管理"])


# Pydantic模型
class ItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="物品名称")
    purchase_date: str = Field(..., description="购买日期 (YYYY-MM-DD)")
    purchase_amount: float = Field(..., gt=0, description="购买金额")

    @validator('purchase_date')
    def validate_date(cls, v):
        try:
            parsed_date = parse_date(v)
            if parsed_date > date.today():
                raise ValueError("购买日期不能是未来日期")
            return v
        except ValueError:
            raise ValueError("日期格式无效，请使用 YYYY-MM-DD 格式")

    @validator('purchase_amount')
    def validate_amount(cls, v):
        if v <= 0:
            raise ValueError("购买金额必须大于0")
        return round(v, 2)


class ItemUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255, description="物品名称")
    purchase_date: Optional[str] = Field(None, description="购买日期 (YYYY-MM-DD)")
    purchase_amount: Optional[float] = Field(None, gt=0, description="购买金额")

    @validator('purchase_date')
    def validate_date(cls, v):
        if v is not None:
            try:
                parsed_date = parse_date(v)
                if parsed_date > date.today():
                    raise ValueError("购买日期不能是未来日期")
                return v
            except ValueError:
                raise ValueError("日期格式无效，请使用 YYYY-MM-DD 格式")
        return v

    @validator('purchase_amount')
    def validate_amount(cls, v):
        if v is not None and v <= 0:
            raise ValueError("购买金额必须大于0")
        return round(v, 2) if v is not None else None


class ItemResponse(BaseModel):
    id: int
    name: str
    purchase_date: str
    purchase_amount: float
    daily_cost: float
    days_used: int
    created_at: str

    class Config:
        from_attributes = True


class BatchDeleteRequest(BaseModel):
    item_ids: list[int] = Field(..., min_items=1, description="物品ID列表")


@router.get("/", summary="获取物品列表")
async def get_items(
    page: int = Query(1, ge=1, description="页码"),
    size: int = Query(10, ge=1, le=100, description="每页数量"),
    search: Optional[str] = Query(None, description="搜索关键词"),
    start_date: Optional[str] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    sort_by: Optional[str] = Query("purchase_date", description="排序字段"),
    sort_order: Optional[str] = Query("desc", regex="^(asc|desc)$", description="排序顺序"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session)
):
    """
    获取用户物品列表，支持分页、搜索、过滤和排序
    """
    try:
        # 构建查询条件
        conditions = [Item.user_id == current_user.id, Item.is_delete == False]

        # 搜索条件
        if search:
            conditions.append(Item.name.like(f"%{search}%"))

        # 日期范围过滤
        if start_date:
            try:
                start_date_obj = parse_date(start_date)
                conditions.append(Item.purchase_date >= start_date_obj)
            except ValueError:
                return error_response("开始日期格式无效", "INVALID_START_DATE")

        if end_date:
            try:
                end_date_obj = parse_date(end_date)
                conditions.append(Item.purchase_date <= end_date_obj)
            except ValueError:
                return error_response("结束日期格式无效", "INVALID_END_DATE")

        # 排序
        order_column = getattr(Item, sort_by, Item.purchase_date)
        if sort_order == "asc":
            order_by = order_column.asc()
        else:
            order_by = order_column.desc()

        # 查询总数
        count_stmt = select(func.count(Item.id)).where(and_(*conditions))
        total_result = await db.execute(count_stmt)
        total = total_result.scalar()

        # 查询数据
        stmt = select(Item).where(and_(*conditions)).order_by(order_by).offset((page - 1) * size).limit(size)
        result = await db.execute(stmt)
        items = result.scalars().all()

        # 计算日均成本和格式化数据
        item_list = []
        for item in items:
            days_used = get_days_since(item.purchase_date)
            daily_cost = calculate_daily_cost(item.purchase_amount, item.purchase_date)

            item_data = {
                "id": item.id,
                "name": item.name,
                "purchase_date": format_date(item.purchase_date),
                "purchase_amount": float(item.purchase_amount),
                "daily_cost": daily_cost,
                "days_used": days_used,
                "created_at": item.created_at.isoformat() if item.created_at else None
            }
            item_list.append(item_data)

        return paginated_response(item_list, total, page, size, "查询物品列表成功")

    except HTTPException:
        raise
    except Exception as e:
        return error_response(f"查询物品列表失败: {str(e)}", "GET_ITEMS_ERROR")


@router.get("/{item_id}", summary="获取单个物品详情")
async def get_item(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session)
):
    """
    获取单个物品的详细信息
    """
    try:
        stmt = select(Item).where(
            and_(
                Item.id == item_id,
                Item.user_id == current_user.id,
                Item.is_delete == False
            )
        )
        result = await db.execute(stmt)
        item = result.scalar_one_or_none()

        if not item:
            return error_response("物品不存在", "ITEM_NOT_FOUND", 404)

        days_used = get_days_since(item.purchase_date)
        daily_cost = calculate_daily_cost(item.purchase_amount, item.purchase_date)

        item_data = {
            "id": item.id,
            "name": item.name,
            "purchase_date": format_date(item.purchase_date),
            "purchase_amount": float(item.purchase_amount),
            "daily_cost": daily_cost,
            "days_used": days_used,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "updated_at": item.updated_at.isoformat() if item.updated_at else None
        }

        return success_response(item_data, "获取物品详情成功")

    except Exception as e:
        return error_response(f"获取物品详情失败: {str(e)}", "GET_ITEM_ERROR")


@router.post("/", summary="创建新物品")
async def create_item(
    item_data: ItemCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session)
):
    """
    创建新的物品记录
    """
    try:
        # 创建物品
        item = Item(
            user_id=current_user.id,
            name=item_data.name,
            purchase_date=parse_date(item_data.purchase_date),
            purchase_amount=item_data.purchase_amount,
            daily_cost=calculate_daily_cost(item_data.purchase_amount, parse_date(item_data.purchase_date))
        )

        db.add(item)
        await db.commit()
        await db.refresh(item)

        days_used = get_days_since(item.purchase_date)

        response_data = {
            "id": item.id,
            "name": item.name,
            "purchase_date": format_date(item.purchase_date),
            "purchase_amount": float(item.purchase_amount),
            "daily_cost": item.daily_cost,
            "days_used": days_used,
            "created_at": item.created_at.isoformat() if item.created_at else None
        }

        return success_response(response_data, "创建物品成功", 201)

    except ValueError as e:
        return error_response(str(e), "VALIDATION_ERROR", 400)
    except Exception as e:
        await db.rollback()
        return error_response(f"创建物品失败: {str(e)}", "CREATE_ITEM_ERROR")


@router.put("/{item_id}", summary="更新物品")
async def update_item(
    item_id: int,
    item_data: ItemUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session)
):
    """
    更新物品信息
    """
    try:
        # 查询物品
        stmt = select(Item).where(
            and_(
                Item.id == item_id,
                Item.user_id == current_user.id,
                Item.is_delete == False
            )
        )
        result = await db.execute(stmt)
        item = result.scalar_one_or_none()

        if not item:
            return error_response("物品不存在", "ITEM_NOT_FOUND", 404)

        # 更新字段
        if item_data.name is not None:
            item.name = item_data.name
        if item_data.purchase_date is not None:
            item.purchase_date = parse_date(item_data.purchase_date)
        if item_data.purchase_amount is not None:
            item.purchase_amount = item_data.purchase_amount

        # 重新计算日均成本
        item.daily_cost = calculate_daily_cost(item.purchase_amount, item.purchase_date)

        await db.commit()
        await db.refresh(item)

        days_used = get_days_since(item.purchase_date)

        response_data = {
            "id": item.id,
            "name": item.name,
            "purchase_date": format_date(item.purchase_date),
            "purchase_amount": float(item.purchase_amount),
            "daily_cost": item.daily_cost,
            "days_used": days_used,
            "updated_at": item.updated_at.isoformat() if item.updated_at else None
        }

        return success_response(response_data, "更新物品成功")

    except ValueError as e:
        return error_response(str(e), "VALIDATION_ERROR", 400)
    except Exception as e:
        await db.rollback()
        return error_response(f"更新物品失败: {str(e)}", "UPDATE_ITEM_ERROR")


@router.delete("/{item_id}", summary="删除物品")
async def delete_item(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session)
):
    """
    删除物品（软删除）
    """
    try:
        # 查询物品
        stmt = select(Item).where(
            and_(
                Item.id == item_id,
                Item.user_id == current_user.id,
                Item.is_delete == False
            )
        )
        result = await db.execute(stmt)
        item = result.scalar_one_or_none()

        if not item:
            return error_response("物品不存在", "ITEM_NOT_FOUND", 404)

        # 软删除
        item.is_delete = True
        await db.commit()

        return success_response({"id": item_id}, "删除物品成功")

    except Exception as e:
        await db.rollback()
        return error_response(f"删除物品失败: {str(e)}", "DELETE_ITEM_ERROR")


@router.delete("/batch", summary="批量删除物品")
async def batch_delete_items(
    request_data: BatchDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session)
):
    """
    批量删除物品（软删除）
    """
    try:
        # 查询要删除的物品
        stmt = select(Item).where(
            and_(
                Item.id.in_(request_data.item_ids),
                Item.user_id == current_user.id,
                Item.is_delete == False
            )
        )
        result = await db.execute(stmt)
        items = result.scalars().all()

        if not items:
            return error_response("没有找到要删除的物品", "NO_ITEMS_FOUND", 404)

        # 批量软删除
        for item in items:
            item.is_delete = True

        await db.commit()

        deleted_count = len(items)
        return success_response(
            {"deleted_count": deleted_count, "item_ids": [item.id for item in items]},
            f"成功删除{deleted_count}个物品"
        )

    except Exception as e:
        await db.rollback()
        return error_response(f"批量删除失败: {str(e)}", "BATCH_DELETE_ERROR")

