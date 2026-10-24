from collections import Counter
from decimal import ROUND_HALF_UP, Decimal

from app.schemas import ExpenseOut, ItemCreate


def yuan(value):
    return (
        None
        if value is None
        else format(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), ".2f")
    )


def metrics(item, today):
    extra = sum(expense.amount_cents for expense in item.expenses)
    known = (item.purchase_amount_cents or 0) + extra
    total = known if item.purchase_amount_cents is not None else None
    end = today if item.status == "active" else item.disposal_date
    days = (end - item.purchase_date).days + 1 if end and item.purchase_date else None
    net = (
        total - item.recovery_amount_cents
        if item.status != "active" and total is not None and item.recovery_amount_cents is not None
        else None
    )
    daily = Decimal(total) / 100 / days if total is not None and days and days > 0 else None
    actual = Decimal(net) / 100 / days if net is not None and days and days > 0 else None
    return {
        "as_of_date": today,
        "extra_cents": extra,
        "known_investment_cents": known,
        "total_investment_cents": total,
        "holding_days": days,
        "net_cost_cents": net,
        "current_daily_yuan": yuan(daily) if item.status == "active" else None,
        "actual_daily_yuan": yuan(actual),
    }


def item_out(item, today):
    return {
        **{key: getattr(item, key) for key in ItemCreate.model_fields},
        **{
            key: getattr(item, key)
            for key in (
                "id",
                "space_id",
                "created_at",
                "status",
                "disposal_date",
                "recovery_amount_cents",
                "deleted_at",
                "revision",
            )
        },
        "expenses": [ExpenseOut.model_validate(expense).model_dump() for expense in item.expenses],
        "metrics": metrics(item, today),
    }


def aggregates(items, today):
    counts = Counter(item.status for item in items)
    common = {
        "as_of_date": today,
        "item_count": len(items),
        "status_counts": {state: counts[state] for state in ("active", "sold", "retired")},
        "purchase_amount_missing_count": sum(item.purchase_amount_cents is None for item in items),
    }
    values = [(item, metrics(item, today)) for item in items]
    active = [(item, m) for item, m in values if item.status == "active"]
    daily = [
        Decimal(m["total_investment_cents"]) / 100 / m["holding_days"]
        for _, m in active
        if m["current_daily_yuan"] is not None
    ]
    disposed = [m for item, m in values if item.status != "active"]
    net = [m["net_cost_cents"] for m in disposed if m["net_cost_cents"] is not None]
    summary = {
        **common,
        "known_investment_cents": sum(m["known_investment_cents"] for _, m in values),
        "current_daily": {
            "known_amount_yuan": yuan(sum(daily, Decimal(0))) if daily or not active else None,
            "holding_count": len(active),
            "incomplete_count": len(active) - len(daily),
            "complete": len(active) == len(daily),
        },
    }
    analytics = {
        **common,
        "known_purchase_cents": sum(item.purchase_amount_cents or 0 for item in items),
        "extra_cents": sum(m["extra_cents"] for _, m in values),
        "disposed": {
            "item_count": len(disposed),
            "known_net_cost_cents": sum(net) if net or not disposed else None,
            "incomplete_count": len(disposed) - len(net),
        },
    }
    return summary, analytics
