# Synon local runtime image for the ASKCOS Vue UI.
# Build the UI in WSL first with:
#   cd askcos_vue && npm ci && npm run build
# The Docker image then packages the verified dist output into nginx.
FROM nginx:1.25.5-alpine

RUN rm -rf /usr/share/nginx/html/*

COPY askcos_vue/nginx.conf /etc/nginx/nginx.conf
COPY askcos_vue/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
