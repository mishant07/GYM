FROM nginx:alpine

# Copy static site files to Nginx web root
COPY . /usr/share/nginx/html

# Expose port 80 for Render / Docker hosting
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
