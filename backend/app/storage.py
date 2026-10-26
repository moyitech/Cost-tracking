import httpx
from qcloud_cos import CosConfig, CosS3Client

from app.errors import ApiError, invalid


class CosStorage:
    """Only control/metadata traffic crosses the API. COS performs object copies internally."""

    def __init__(self, settings):
        self.settings = settings
        self._client = None

    @property
    def client(self):
        s = self.settings
        if not all(
            [
                s.cos_secret_id.get_secret_value(),
                s.cos_secret_key.get_secret_value(),
                s.cos_bucket,
                s.cos_region,
            ]
        ):
            raise ApiError(503, "SERVICE_UNAVAILABLE", "COS 尚未配置")
        if self._client is None:
            self._client = CosS3Client(
                CosConfig(
                    Region=s.cos_region,
                    SecretId=s.cos_secret_id.get_secret_value(),
                    SecretKey=s.cos_secret_key.get_secret_value(),
                    Token=s.cos_session_token.get_secret_value() or None,
                    Scheme="https",
                    Timeout=15,
                )
            )
        return self._client

    def upload_url(self, file):
        try:
            return self.client.get_presigned_url(
                Method="PUT",
                Bucket=self.settings.cos_bucket,
                Key=file.staging_key,
                Expired=self.settings.cos_signed_url_ttl_seconds,
                Headers={"Content-Type": file.mime_type},
            )
        except ApiError:
            raise
        except Exception:
            raise ApiError(503, "SERVICE_UNAVAILABLE", "暂时无法签发上传地址") from None

    def complete(self, file):
        try:
            meta = self.client.head_object(Bucket=self.settings.cos_bucket, Key=file.staging_key)
            if int(meta["Content-Length"]) != file.size_bytes:
                invalid("size_bytes", "实际上传大小与声明不符")
            # Freeze the upload before validation: the still-valid PUT URL cannot change the final object.
            self.client.copy_object(
                Bucket=self.settings.cos_bucket,
                Key=file.object_key,
                CopySource={
                    "Bucket": self.settings.cos_bucket,
                    "Region": self.settings.cos_region,
                    "Key": file.staging_key,
                },
                CopySourceIfMatch=meta["ETag"],
            )
            info_url = self.client.get_presigned_url(
                Method="GET",
                Bucket=self.settings.cos_bucket,
                Key=file.object_key,
                Expired=60,
                Params={"imageInfo": ""},
            )
            # COS CI returns JSON metadata, never the image body. Require imageInfo support on the bucket.
            with httpx.Client(timeout=20) as http:
                with http.stream("GET", info_url) as response:
                    if (
                        response.status_code != 200
                        or "json" not in response.headers.get("content-type", "").lower()
                    ):
                        raise ApiError(
                            503,
                            "SERVICE_UNAVAILABLE",
                            "COS 图片信息校验不可用，请检查数据万象 imageInfo 能力",
                        )
                    data = bytearray()
                    for chunk in response.iter_bytes(chunk_size=4096):
                        data.extend(chunk)
                        if len(data) > 65536:
                            raise ApiError(503, "SERVICE_UNAVAILABLE", "COS 图片信息响应异常")
            import json

            info = json.loads(data)
            actual = {
                "jpeg": "image/jpeg",
                "jpg": "image/jpeg",
                "png": "image/png",
                "webp": "image/webp",
            }.get(str(info.get("format", info.get("Format", ""))).lower())
            if actual != file.mime_type:
                invalid("mime_type", "图片真实格式与声明不符，或图片无效")
        except ApiError:
            raise
        except Exception:
            raise ApiError(
                503, "SERVICE_UNAVAILABLE", "上传尚未完成或 COS 校验失败，请稍后重试"
            ) from None

    def access_url(self, file, size="original"):
        # COS CI reads its transform from the query *key*, not imageMogr2=<value>.
        params = {"imageMogr2/thumbnail/1024x1024>/format/webp/quality/75": ""} if size == "preview" else {}
        return self._access_url(file.object_key, params)

    def preset_url(self, preset, size):
        return self._access_url(
            preset.preview_object_key if size == "preview" else preset.object_key
        )

    def _access_url(self, object_key, params=None):
        try:
            return self.client.get_presigned_url(
                Method="GET",
                Bucket=self.settings.cos_bucket,
                Key=object_key,
                Expired=self.settings.cos_signed_url_ttl_seconds,
                Params=params or {},
            )
        except ApiError:
            raise
        except Exception:
            raise ApiError(503, "SERVICE_UNAVAILABLE", "暂时无法签发访问地址") from None
