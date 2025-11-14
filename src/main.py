from fastapi import FastAPI, Request
from src.router.items import router as items_router

app = FastAPI()
app.include_router(items_router)


@app.get("/ping")
async def ping():
    return {"message": "pong"}





if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)