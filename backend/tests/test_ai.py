"""Synthetic model responses: no user images, network calls or database required."""

import json
from types import SimpleNamespace

import httpx
import pytest
from pydantic import SecretStr

from app.ai import recognize
from app.errors import ApiError


def recognize_items(items, finish_reason="stop", image_count=1, inspect=None):
    settings = SimpleNamespace(
        ai_enabled=True,
        ai_api_key=SecretStr("synthetic-test-key"),
        ai_model="deepseek-flash",
        ai_base_url="https://api.deepseek.com",
        ai_thinking_enabled=True,
        ai_max_output_tokens=None,
        ai_timeout_seconds=60,
        ai_import_max_sources=9,
    )

    def provider(request):
        payload = json.loads(request.content)
        assert payload["response_format"] == {"type": "json_object"}
        assert payload["thinking"] == {"type": "enabled"}
        assert "max_tokens" not in payload
        if inspect:
            inspect(payload)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": finish_reason,
                        "message": {
                            "content": json.dumps(
                                {"items": [{"source_indexes": [1], **item} for item in items]}
                            )
                        },
                    }
                ],
            },
        )

    return recognize(
        settings,
        [f"https://cos.example/image{i}" for i in range(image_count)],
        httpx.MockTransport(provider),
    )


def order_rows():
    # Two identical products belong to different orders. The canceled gift's status
    # is deliberately unknown: the backend must inherit status via order_ref.
    return [
        {
            "name": "示例充电器",
            "quantity": 1,
            "order_ref": "order_1",
            "order_status": "completed",
            "purchase_amount_cents": 11059,
            "amount_scope": "line_total",
            "amount_kind": "displayed",
            "evidence": {"purchase_date": {"text": None, "confidence": None}},
        },
        {
            "name": "示例手柄",
            "quantity": 1,
            "order_ref": "order_2",
            "order_status": "completed",
            "purchase_amount_cents": 15718,
            "amount_scope": "line_total",
            "amount_kind": "displayed",
        },
        {
            "name": None,
            "quantity": 1,
            "order_ref": "order_2",
            "is_gift": True,
            "purchase_amount_cents": 0,
            "amount_scope": "line_total",
            "evidence": {"is_gift": {"text": "赠品"}, "note": {"text": None}},
        },
        {
            "name": "示例手柄",
            "quantity": 1,
            "order_ref": "order_3",
            "order_status": "canceled",
            "purchase_amount_cents": 15718,
            "amount_scope": "line_total",
        },
        {
            "name": None,
            "quantity": 1,
            "order_ref": "order_3",
            "is_gift": True,
            "purchase_amount_cents": 0,
            "amount_scope": "line_total",
            "evidence": {"is_gift": {"text": "赠品"}},
        },
    ]


def test_order_cards_null_evidence_single_line_price_and_canceled_gift():
    entries = recognize_items(order_rows())
    assert len(entries) == 3 and all(e["included"] for e in entries)
    assert [e["values"]["purchase_amount_cents"] for e in entries[:3]] == [11059, 15718, 0]
    assert sum(e["values"]["purchase_amount_cents"] for e in entries if e["included"]) == 26777
    assert all(e["values"]["purchase_date"] is None for e in entries)
    assert entries[0]["field_sources"]["purchase_date"]["text"] == ""
    assert entries[2]["values"]["name"] is None
    assert entries[2]["field_sources"]["purchase_amount_cents"]["text"] == "赠品"
    assert all("order_ref" not in e["values"] for e in entries)
    assert any("尚不能确认实付" in w for w in entries[0]["warnings"])


def test_cancellation_not_linked_by_name_or_missing_order_ref():
    entries = recognize_items(
        [
            {"name": "相同商品", "order_status": "canceled"},
            {"name": "相同商品", "order_status": "completed"},
            {"name": "赠品", "is_gift": True},
        ]
    )
    assert len(entries) == 2 and all(e["included"] for e in entries)
    assert [e["values"]["name"] for e in entries] == ["相同商品", "赠品"]


def test_cancel_status_is_not_guessed_from_after_sales_text():
    entries = recognize_items(
        [
            {
                "name": "已完成商品",
                "order_status": "completed",
                "warnings": ["页面有退款/售后、删除订单按钮，不能据此判断已取消"],
                "evidence": {"order_status": {"text": "完成"}},
            }
        ]
    )
    assert entries[0]["included"] is True


@pytest.mark.parametrize(
    ("quantity", "scope", "kind", "amount", "expected"),
    [
        (1, "line_total", "displayed", 1234, [1234]),
        (1, "single_unit", "paid", 1234, [1234]),
        (1, "order_total", "paid", 1234, [None]),
        (1, "unknown", "paid", 1234, [None]),
        (1, "single_unit", "promotion", 1234, [None]),
        (2, "line_total", "paid", 1234, [None, None]),
        (2, "single_unit", "paid", 1234, [1234, 1234]),
        (2, "single_unit", "displayed", 1234, [1234, 1234]),
        (None, "single_unit", "paid", 1234, [1234]),
        (None, "single_unit", "displayed", 1234, [1234]),
        (None, "line_total", "displayed", 1234, [None]),
        (None, "order_total", "paid", 1234, [None]),
        (None, "single_unit", "promotion", 1234, [None]),
        (1, "single_unit", "unknown", None, [None]),
        (1, "single_unit", "unknown", 0, [None]),
    ],
)
def test_money_is_never_divided_or_inferred(quantity, scope, kind, amount, expected):
    entries = recognize_items(
        [
            {
                "name": "测试商品",
                "quantity": quantity,
                "purchase_amount_cents": amount,
                "amount_scope": scope,
                "amount_kind": kind,
            }
        ]
    )
    assert [e["values"]["purchase_amount_cents"] for e in entries] == expected


def test_product_price_without_quantity_is_prefilled_without_extra_confirmation():
    # Regression: the provider read the price correctly, but normalization used
    # to discard it solely because the screenshot did not state the quantity.
    entry = recognize_items(
        [
            {
                "name": "iPhone 18 Pro Max 512GB 银色",
                "quantity": None,
                "purchase_amount_cents": 1299900,
                "amount_scope": "single_unit",
                "amount_kind": "displayed",
                "order_status": "completed",
                "evidence": {
                    "purchase_amount_cents": {"text": "RMB 12,999"},
                    "order_status": {"text": "已取货 2026年10月7日"},
                },
            }
        ]
    )[0]
    assert entry["values"] == {
        "name": "iPhone 18 Pro Max 512GB 银色",
        "purchase_amount_cents": 1299900,
        "purchase_date": None,
    }
    assert "quantity_resolved" not in entry
    assert entry["field_sources"]["purchase_amount_cents"]["text"] == "RMB 12,999"
    assert not any("已留空" in warning for warning in entry["warnings"])


@pytest.mark.parametrize(
    "evidence",
    [
        {"is_gift": {"text": "赠品"}},
        {"purchase_amount_cents": {"text": "实付¥0.00"}},
    ],
)
def test_explicit_zero_is_preserved(evidence):
    entry = recognize_items(
        [
            {
                "name": "赠品",
                "quantity": 1,
                "is_gift": True,
                "purchase_amount_cents": 0,
                "amount_scope": "line_total",
                "evidence": evidence,
            }
        ]
    )[0]
    assert entry["values"]["purchase_amount_cents"] == 0


@pytest.mark.parametrize("raw", ["2026-02-30", "20261001", "2026-10", "02:39"])
def test_unusable_date_remains_unknown(raw):
    entry = recognize_items([{"name": "商品", "purchase_date": raw}])[0]
    assert entry["values"]["purchase_date"] is None


@pytest.mark.parametrize("amount", [True, "1234", 12.34, -1])
def test_null_evidence_tolerance_does_not_coerce_bad_money(amount):
    with pytest.raises(ApiError) as exc:
        recognize_items([{"purchase_amount_cents": amount}])
    assert exc.value.code == "AI_RECOGNITION_FAILED"


def test_partial_or_empty_model_response_is_not_success():
    with pytest.raises(ApiError) as exc:
        recognize_items([{"name": "商品"}], finish_reason="length")
    assert exc.value.code == "AI_RECOGNITION_FAILED"
    assert recognize_items([]) == []


def test_full_order_refund_filters_its_gift_but_not_other_orders():
    entries = recognize_items(
        [
            {"name": "手柄", "order_ref": "a", "order_status": "completed"},
            {"name": "手柄", "order_ref": "b", "order_status": "refunded"},
            {"name": "赠品", "order_ref": "b", "is_gift": True},
        ]
    )
    assert len(entries) == 1 and entries[0]["values"]["name"] == "手柄"


@pytest.mark.parametrize("status", ["partial", "pending", "unknown"])
def test_item_refund_scoped_to_one_row_and_partial_pending_are_kept(status):
    entries = recognize_items(
        [
            {"name": "已退商品", "order_ref": "a", "refund_status": "refunded"},
            {"name": "仍持有商品", "order_ref": "a", "refund_status": status},
        ]
    )
    assert len(entries) == 1 and entries[0]["values"]["name"] == "仍持有商品"


def test_multiple_images_are_in_one_request_with_combined_provenance():
    calls = []

    def inspect(payload):
        calls.append(payload)
        content = payload["messages"][1]["content"]
        assert [p["image_url"]["url"] for p in content if p["type"] == "image_url"] == [
            "https://cos.example/image0",
            "https://cos.example/image1",
            "https://cos.example/image2",
        ]
        assert "不能在每张图片重新" in payload["messages"][0]["content"]

    entries = recognize_items(
        [
            {
                "name": "重叠截图中同一行",
                "source_indexes": [2, 1, 2],
                "order_ref": "a",
                "quantity": 1,
            },
            {"name": "重叠截图中同一行", "source_indexes": [3], "order_ref": "b", "quantity": 1},
            {"name": "已取消", "source_indexes": [1], "order_ref": "c", "order_status": "canceled"},
            {"name": "跨图赠品", "source_indexes": [2], "order_ref": "c", "is_gift": True},
        ],
        image_count=3,
        inspect=inspect,
    )
    assert len(calls) == 1 and len(entries) == 2
    assert [e["source_indexes"] for e in entries] == [[1, 2], [3]]


@pytest.mark.parametrize("indexes", [[], [0], [-1], [3], [True], ["1"]])
def test_invalid_source_indexes_reject_entire_response(indexes):
    with pytest.raises(ApiError):
        recognize_items([{"name": "商品", "source_indexes": indexes}], image_count=2)
