FROM node:22.22.0-alpine
WORKDIR /app
COPY server.mjs ./server.mjs
COPY diagnostics.mjs ./diagnostics.mjs
ENV NODE_ENV=production
USER node
EXPOSE 8788
CMD ["node", "server.mjs"]
