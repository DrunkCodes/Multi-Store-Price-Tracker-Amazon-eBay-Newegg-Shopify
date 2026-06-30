FROM apify/actor-node-playwright:22

COPY package*.json ./

RUN npm install --include=dev \
    && npm run build

COPY . ./

CMD npm run start:prod
