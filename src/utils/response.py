from typing import Any, Dict, Optional, Union
from pydantic import BaseModel


class APIResponse(BaseModel):
    """标准API响应格式"""
    success: bool = True
    message: str = "操作成功"
    data: Optional[Any] = None
    code: int = 200


class ErrorResponse(BaseModel):
    """错误响应格式"""
    success: bool = False
    message: str
    error_code: Optional[str] = None
    data: Optional[Any] = None
    code: int = 400


class PaginationResponse(BaseModel):
    """分页响应格式"""
    items: list
    total: int
    page: int
    size: int
    pages: int


def success_response(
    data: Any = None,
    message: str = "操作成功",
    code: int = 200
) -> Dict[str, Any]:
    """成功响应"""
    return {
        "success": True,
        "message": message,
        "data": data,
        "code": code
    }


def error_response(
    message: str,
    error_code: Optional[str] = None,
    data: Any = None,
    code: int = 400
) -> Dict[str, Any]:
    """错误响应"""
    return {
        "success": False,
        "message": message,
        "error_code": error_code,
        "data": data,
        "code": code
    }


def paginated_response(
    items: list,
    total: int,
    page: int,
    size: int,
    message: str = "查询成功"
) -> Dict[str, Any]:
    """分页响应"""
    pages = (total + size - 1) // size
    return {
        "success": True,
        "message": message,
        "data": {
            "items": items,
            "total": total,
            "page": page,
            "size": size,
            "pages": pages
        },
        "code": 200
    }