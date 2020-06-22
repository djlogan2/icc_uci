# Filename: Dockerfile
FROM ubuntu:latest
WORKDIR .
RUN apt-get update && apt-get install -y apt-transport-https
RUN apt-get install --yes curl
RUN curl -sL https://deb.nodesource.com/setup_14.x | bash -
RUN apt-get install --yes nodejs
RUN apt-get install --yes build-essential
COPY *.js ./
COPY package.json .
COPY docker/stockfish_20011801_x64_modern .
COPY docker/book.bin .
RUN chmod +x stockfish_20011801_x64_modern
RUN npm install
EXPOSE 3010
ENV ENGINE /stockfish_20011801_x64_modern
ENV BOOK /book.bin
#ENV OPTIONS [[\"Hash\", \"1024\"]]
ENV PORT 3010
CMD ["node", "stockfish.js"]
