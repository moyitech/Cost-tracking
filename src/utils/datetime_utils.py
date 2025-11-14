from datetime import datetime, date
from typing import Union


def calculate_daily_cost(purchase_amount: float, purchase_date: Union[date, datetime]) -> float:
    """
    计算日均成本

    Args:
        purchase_amount: 购买金额
        purchase_date: 购买日期

    Returns:
        日均成本
    """
    if isinstance(purchase_date, datetime):
        purchase_date = purchase_date.date()

    today = datetime.now().date()
    days_used = max(1, (today - purchase_date).days)

    return round(purchase_amount / days_used, 4)


def format_date(date_obj: Union[date, datetime]) -> str:
    """
    格式化日期

    Args:
        date_obj: 日期对象

    Returns:
        格式化后的日期字符串 (YYYY-MM-DD)
    """
    if isinstance(date_obj, datetime):
        date_obj = date_obj.date()

    return date_obj.strftime("%Y-%m-%d")


def parse_date(date_str: str) -> date:
    """
    解析日期字符串

    Args:
        date_str: 日期字符串 (YYYY-MM-DD)

    Returns:
        日期对象
    """
    return datetime.strptime(date_str, "%Y-%m-%d").date()


def get_days_since(purchase_date: Union[date, datetime]) -> int:
    """
    获取购买日期至今的天数

    Args:
        purchase_date: 购买日期

    Returns:
        天数
    """
    if isinstance(purchase_date, datetime):
        purchase_date = purchase_date.date()

    today = datetime.now().date()
    return (today - purchase_date).days