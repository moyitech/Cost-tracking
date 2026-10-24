class ApiError(Exception):
    def __init__(self, status, code, message, *, details=None, fields=None):
        self.status = status
        self.code = code
        self.message = message
        self.details = details or {}
        self.fields = fields or []


def invalid(field, message, code="INVALID_VALUE"):
    raise ApiError(
        422,
        "VALIDATION_ERROR",
        message,
        fields=[{"field": field, "code": code, "message": message}],
    )


def not_found():
    raise ApiError(404, "NOT_FOUND", "资源不存在或不可访问")
