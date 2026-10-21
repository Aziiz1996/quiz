import os
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
import pandas as pd
import plotly.express as px

app = FastAPI(title="AZZ Logistics Analytics", docs_url=None, redoc_url=None)
class Result(BaseModel):
    course: str = Field(min_length=1, max_length=100)
    score: float = Field(ge=0, le=100)

class Batch(BaseModel):
    results: list[Result] = Field(min_length=1, max_length=1000)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/api/analytics/summary")
def summary(batch: Batch, x_analytics_key: str | None = Header(default=None)):
    secret = os.getenv("ANALYTICS_API_KEY")
    if not secret or x_analytics_key != secret:
        raise HTTPException(status_code=401, detail="Unauthorized")
    frame = pd.DataFrame([r.model_dump() for r in batch.results])
    grouped = frame.groupby("course", as_index=False).agg(average=("score","mean"), attempts=("score","size"))
    fig = px.bar(grouped, x="course", y="average", hover_data=["attempts"], title="متوسط النتائج حسب المقرر")
    return {"courses": grouped.to_dict(orient="records"), "chart": fig.to_dict()}
