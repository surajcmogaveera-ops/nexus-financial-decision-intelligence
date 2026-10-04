from fastapi import FastAPI

from app.api.routes import router as api_router

app = FastAPI()
app.include_router(api_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
