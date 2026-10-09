from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import pandas as pd
import joblib
from contextlib import asynccontextmanager


ml_model = {}  # {'model': 'credit_risk_model.pkl'}


# Lifespan: load model once when server starts, unload on shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    ml_model['model']     = joblib.load('credit_risk_model.pkl')
    ml_model['threshold'] = joblib.load('best_threshold.pkl')
    yield
    ml_model.clear()


app = FastAPI(lifespan=lifespan)

# ── CORS: allow the browser UI to call the API from any origin ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # tighten to your Render URL in production if needed
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Serve static files (HTML / CSS / JS) under /static ──
app.mount("/static", StaticFiles(directory="static"), name="static")


# The only columns the user will see and provide inputs for
class LoanApplication(BaseModel):  # Pydantic Model (Validation)
    person_age: int
    person_income: float
    person_home_ownership: str
    person_emp_length: float
    loan_intent: str
    loan_grade: str
    loan_amnt: float
    loan_int_rate: float
    loan_percent_income: float
    cb_person_default_on_file: str
    cb_person_cred_hist_length: int


# ── Serve the UI at root ──
@app.get("/")
def serve_ui():
    return FileResponse("static/index.html")


@app.post("/predict")
def predict(data: LoanApplication):
    input_df = pd.DataFrame([data.dict()])

    probability = ml_model['model'].predict_proba(input_df)[:, 1][0]
    prediction  = int(probability >= ml_model['threshold'])

    return {
        "default_probability": probability,
        "default_prediction":  prediction,
        "threshold":           ml_model["threshold"],
        "Result":              "High Risk" if prediction == 1 else "Low Risk",
    }

# User enters 11 values
#        ↓
# LoanApplication validates them
#        ↓
# Pandas creates DataFrame
#        ↓
# credit_risk_model.pkl predicts probability
#        ↓
# best_threshold.pkl provides threshold
#        ↓
# probability >= threshold?
#        ↓
#   ┌───────────────┐
#   │ Yes → 1       │ → High Risk
#   │ No  → 0       │ → Low Risk
#   └───────────────┘