FROM apify/actor-node-playwright:22

# Apify base images run as myuser — files must not be root-owned (avoids EACCES on package-lock.json)
COPY --chown=myuser:myuser package*.json ./

RUN npm --quiet set progress=false \
    && npm install --include=dev --no-audit \
    && echo "Installed NPM packages:" \
    && (npm list --include=dev || true)

COPY --chown=myuser:myuser . ./

RUN npm run build

CMD npm run start:prod
