FROM python:3.15-alpine@sha256:2699b90f4d562a22e2dd076c82f964032f64814204bff36d271a54ba4cc2c7e2

# Alpine saknar tidszonsdata, och zoneinfo behöver den för Europe/Stockholm —
# utan tzdata kraschar API:t direkt vid uppstart.
RUN apk add --no-cache tzdata

RUN addgroup -S chartle && adduser -S -G chartle chartle
WORKDIR /app
COPY app.py /app/app.py

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CHARTLE_DB_PATH=/data/chartle.db

RUN mkdir /data && chown chartle:chartle /data
USER chartle
EXPOSE 8080

CMD ["python", "/app/app.py"]
