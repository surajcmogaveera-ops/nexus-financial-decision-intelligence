# Preserved Python reference backend

This directory preserves the original FastAPI financial application, deterministic Financial/Goal/Risk engines, SQLAlchemy/PostgreSQL models and repository, Alembic migration, and original test suite. It is retained as a temporary reference for the later TypeScript port and parity work; it is not the target Node backend or the new AI service.

Run the original suite from this directory with:

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests -v
```

The existing `.env` remains alongside the preserved Python app. Its contents were not changed or displayed.
