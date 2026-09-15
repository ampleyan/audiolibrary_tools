FROM python:3.11-slim
RUN pip install --no-cache-dir beets requests
COPY server.py /server.py
EXPOSE 8337
CMD ["python", "/server.py"]
