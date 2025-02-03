import os
from pathlib import Path

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_USE_LEGACY_KERAS"] = "1"
os.environ["KERAS_BACKEND"] = "tensorflow"

from fastapi import FastAPI, HTTPException, status, UploadFile, File, Query, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

from deepface.modules import recognition
from PIL import Image
import cv2

from pydantic import BaseModel, EmailStr, Field
from typing import Dict, Optional, List
from datetime import datetime

from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

import numpy as np
import base64
import io
import re

import traceback
from dotenv import load_dotenv

# app.mount("/static", StaticFiles(directory="static"), name="static")

load_dotenv()
app = FastAPI()

MEDIA = os.getenv("MEDIA")
MEDIA_DIR = Path(MEDIA)
ATTENDANCE_DIR = MEDIA_DIR / "attendance"
CSV_DIR = MEDIA_DIR / "csvs"
IMAGE_DIR = MEDIA_DIR / "images"

# print("Media Path:", ATTENDANCE_DIR, CSV_DIR, ATTENDANCE_DIR.resolve(), CSV_DIR.resolve())


def base64_to_numpy(image_b64: str) -> np.ndarray:
    """Convert a base64 string to a NumPy array."""
    image_bytes = base64.b64decode(image_b64)
    np_arr = np.frombuffer(image_bytes, np.uint8)
    return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)


@app.post("/attendance")
async def analyze_image(data: dict):
    try:
        # Extract base64 string (remove data URL prefix if present)
        image_b64 = data["image"].split(",")[-1]
        image_np = base64_to_numpy(image_b64)

        # debug_output_path = r"C:\Users\divyr\Downloads\output_image.jpg"
        # cv2.imwrite(debug_output_path, image_np)
        # print(f"Debug: Image saved to {debug_output_path}")

        try:
            result = recognition.find6(
                img_path=image_np[:, :, ::-1],  # Convert BGR to RGB
                db_path=IMAGE_DIR,
                img_store_path=ATTENDANCE_DIR,
                model_name="ArcFace",
                enforce_detection=False,
                detector_backend="retinaface",
                normalization="ArcFace",
                align=True,
            )
            print(f"Recognition result: {result}")  # Debugging
        except Exception as e:
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Recognition error: {str(e)}")

        height, width, channels = image_np.shape
        return {
            "recognition_result": result,  # Include recognition results in the response
            "dimensions channels": f"{width}x{height}x{channels}",
            "dtype": str(image_np.dtype),
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"Processing error: {str(e)}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
    # ngrok http 8000 => url =>
    # uvicorn.run(app, host="0.0.0.0", port=8000)
