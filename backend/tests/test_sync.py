from unittest.mock import Mock

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import Space, ImagePreset
from app.storage import CosStorage
from tests.conftest import authenticate, create
from tests.test_avatars import upload, save
from tests.test_families import family, invitation, join, member
from tests.test_presets import seed_presets


def manifest(client, headers):
    result = client.get('/api/v1/sync/manifest', headers=headers)
    assert result.status_code == 200, result.text
    return result.json()


def versions(client, headers):
    return {s['id']: int(s['version']) for s in manifest(client, headers)['spaces']}


def test_manifest_is_private_and_reads_do_not_bump_versions(environment):
    c, engine, *_ = environment
    assert c.get('/api/v1/sync/manifest').status_code == 401
    h, sid, _ = authenticate(c)
    _, other, _ = authenticate(c, 'bob')
    before = manifest(c, h)
    assert set(versions(c, h)) == {sid} and other not in versions(c, h)
    c.get(f'/api/v1/spaces/{sid}/items', headers=h)
    assert before['spaces'] == manifest(c, h)['spaces']
    with Session(engine) as db, db.begin():
        db.get(Space, sid).sync_revision = 9007199254740999
    assert manifest(c, h)['spaces'][0]['version'] == '9007199254740999'


def test_item_expense_delete_restore_transfer_and_rollback_versions(environment):
    c, engine, *_ = environment
    h, sid, _ = authenticate(c)
    target = family(c, h)
    before = versions(c, h)
    item = create(c, h, sid, name='离线物品')
    assert versions(c, h)[sid] > before[sid]
    assert versions(c, h)[target] == before[target]
    rev = item['revision']
    r = c.patch(f"/api/v1/items/{item['id']}", headers={**h, 'If-Match': f'"{rev}"'}, json={'note': '新备注'})
    assert r.status_code == 200, r.text
    rev = r.json()['revision']
    baseline = versions(c, h)
    r = c.post(f"/api/v1/items/{item['id']}/expenses", headers={**h, 'If-Match': f'"{rev}"', 'Idempotency-Key': 'expense'}, json={'category': '其他', 'amount_cents': 100, 'occurred_on': '2026-10-18', 'attachment_file_ids': []})
    assert r.status_code == 200, r.text
    assert versions(c, h)[sid] > baseline[sid]
    rev = r.json()['revision']
    baseline = versions(c, h)
    r = c.post(f"/api/v1/items/{item['id']}/transfer", headers={**h, 'If-Match': f'"{rev}"', 'Idempotency-Key': 'transfer'}, json={'target_space_id': target})
    assert r.status_code == 200, r.text
    assert all(versions(c, h)[s] > baseline[s] for s in (sid, target))
    rev = r.json()['revision']
    baseline = versions(c, h)[target]
    assert c.delete(f"/api/v1/items/{item['id']}", headers={**h, 'If-Match': f'"{rev}"'}).status_code == 204
    assert versions(c, h)[target] > baseline
    assert c.post(f"/api/v1/items/{item['id']}/restore", headers={**h, 'If-Match': f'"{rev + 1}"', 'Idempotency-Key': 'restore'}).status_code == 200
    baseline = versions(c, h)
    with Session(engine) as db:
        db.execute(text('UPDATE spaces SET name = :name WHERE id = :id'), {'id': target, 'name': '回滚'})
        db.rollback()
    assert versions(c, h) == baseline
    with Session(engine) as db, db.begin():
        db.execute(text('UPDATE spaces SET name = :name WHERE id = :id'), {'id': target, 'name': '重命名'})
    assert versions(c, h)[target] > baseline[target]


def test_member_and_avatar_updates_invalidate_related_spaces(environment):
    c, engine, *_ = environment
    a, personal, _ = authenticate(c)
    b, _, bob = authenticate(c, 'bob')
    sid = family(c, a)
    assert join(c, b, invitation(c, a, sid)).status_code == 200
    before = versions(c, b)[sid]
    avatar = upload(c, a, personal)
    assert save(c, a, avatar).status_code == 200
    assert versions(c, b)[sid] > before
    before = manifest(c, a)['profile_version']
    assert save(c, a, None).status_code == 200
    assert manifest(c, a)['profile_version'] != before
    bm = member(c, a, sid, bob['user']['id'])
    before = versions(c, a)[sid]
    r = c.post(f'/api/v1/spaces/{sid}/members/me/update', headers={**b, 'If-Match': f'"{bm["revision"]}"'}, json={'nickname': '新昵称'})
    assert r.status_code == 200, r.text
    assert versions(c, a)[sid] > before
    bm = member(c, a, sid, bob['user']['id'])
    assert c.delete(f'/api/v1/spaces/{sid}/members/{bm["id"]}', headers={**a, 'If-Match': f'"{bm["revision"]}"'}).status_code == 204
    assert sid not in versions(c, b)


def test_preset_version_and_preview_access_are_authorized(environment):
    c, engine, settings, _ = environment
    h, sid, _ = authenticate(c)
    seed_presets(engine)
    before = manifest(c, h)
    with Session(engine) as db, db.begin():
        row = db.get(ImagePreset, 'emoji-phone-v1')
        row.version += 1
        row.enabled = False
    after = manifest(c, h)
    assert after['presets_version'] != before['presets_version']
    assert after['preset_versions']['emoji-phone-v1'] == '2'
    file_id = upload(c, h, sid)
    assert save(c, h, file_id).status_code == 200
    assert c.get(f'/api/v1/files/{file_id}/access', headers=h).status_code == 200
    preview = c.get(f'/api/v1/files/{file_id}/access?size=preview', headers=h)
    assert preview.status_code == 200 and preview.json()['url'].endswith('?preview=1')
    stranger, _, _ = authenticate(c, 'stranger')
    assert c.get(f'/api/v1/files/{file_id}/access?size=preview', headers=stranger).status_code == 404
    assert c.get(f'/api/v1/files/{file_id}/access?size=arbitrary', headers=h).status_code == 422
    storage = CosStorage(settings)
    storage._client = Mock()
    storage.access_url(Mock(object_key='private/image'), 'preview')
    assert storage._client.get_presigned_url.call_args.kwargs['Params'] == {'imageMogr2/thumbnail/1024x1024>/format/webp/quality/75': ''}
