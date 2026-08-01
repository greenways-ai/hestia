FROM node:24-alpine
WORKDIR /service
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
EXPOSE 8443
CMD ["node", "src/server.mjs"]
