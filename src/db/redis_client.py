import redis.asyncio as redis
from src.conf.env import settings
from loguru import logger

client: redis.Redis = None


async def init_redis():
    logger.info("redis init!")
    global client
    client = redis.from_url(
        settings.REDIS_CONNECTION,
        decode_responses=True,
        max_connections=20
    )


async def close_redis():
    if client:
        await client.aclose()


if __name__ == "__main__":
    """
    main 使用时无需初始化，只有test时才需要初始化
    直接 import redis_client 即可
    """


    async def main():
        await init_redis()

        # await redis_client.set("foo", "bar", ex=86400)
        # await redis_client.hset("foo", {"a", "abc"}, ex=86400)
        await client.hset("user:1", mapping={"name": "Tom", "age": "25"})
        await client.expire("user:1", 3600)
        val = await client.hgetall("user:1")
        print(type(val))

        await close_redis()
        print(val)


    import asyncio

    asyncio.run(main())