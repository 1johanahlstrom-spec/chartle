FROM python:3.13-alpine

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
