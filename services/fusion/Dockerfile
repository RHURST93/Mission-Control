
FROM python:3.11
WORKDIR /app
COPY . .
RUN pip install "uvicorn[standard]" fastapi
RUN pip install numpy scikit-learn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]