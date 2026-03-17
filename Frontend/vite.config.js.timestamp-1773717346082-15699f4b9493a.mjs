// vite.config.js
import { defineConfig } from "file:///sessions/quirky-kind-dijkstra/mnt/Analyst/analyst/Frontend/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/quirky-kind-dijkstra/mnt/Analyst/analyst/Frontend/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
var __vite_injected_original_dirname = "/sessions/quirky-kind-dijkstra/mnt/Analyst/analyst/Frontend";
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  },
  // During dev: proxy API calls to local Flask (python server.py)
  server: {
    port: 3e3,
    proxy: {
      "/trigger": "http://localhost:5001",
      "/deals": "http://localhost:5001",
      "/settings": "http://localhost:5001",
      "/crm": "http://localhost:5001"
    }
  },
  // Production build goes into Pipeline/static/dist/
  // Flask serves this via the /app route
  build: {
    outDir: "../Pipeline/static/dist",
    emptyOutDir: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvcXVpcmt5LWtpbmQtZGlqa3N0cmEvbW50L0FuYWx5c3QvYW5hbHlzdC9Gcm9udGVuZFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3Nlc3Npb25zL3F1aXJreS1raW5kLWRpamtzdHJhL21udC9BbmFseXN0L2FuYWx5c3QvRnJvbnRlbmQvdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Nlc3Npb25zL3F1aXJreS1raW5kLWRpamtzdHJhL21udC9BbmFseXN0L2FuYWx5c3QvRnJvbnRlbmQvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuaW1wb3J0IHBhdGggZnJvbSAncGF0aCdcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjJyksXG4gICAgfSxcbiAgfSxcbiAgLy8gRHVyaW5nIGRldjogcHJveHkgQVBJIGNhbGxzIHRvIGxvY2FsIEZsYXNrIChweXRob24gc2VydmVyLnB5KVxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiAzMDAwLFxuICAgIHByb3h5OiB7XG4gICAgICAnL3RyaWdnZXInOiAgICdodHRwOi8vbG9jYWxob3N0OjUwMDEnLFxuICAgICAgJy9kZWFscyc6ICAgICAnaHR0cDovL2xvY2FsaG9zdDo1MDAxJyxcbiAgICAgICcvc2V0dGluZ3MnOiAgJ2h0dHA6Ly9sb2NhbGhvc3Q6NTAwMScsXG4gICAgICAnL2NybSc6ICAgICAgICdodHRwOi8vbG9jYWxob3N0OjUwMDEnLFxuICAgIH0sXG4gIH0sXG4gIC8vIFByb2R1Y3Rpb24gYnVpbGQgZ29lcyBpbnRvIFBpcGVsaW5lL3N0YXRpYy9kaXN0L1xuICAvLyBGbGFzayBzZXJ2ZXMgdGhpcyB2aWEgdGhlIC9hcHAgcm91dGVcbiAgYnVpbGQ6IHtcbiAgICBvdXREaXI6ICcuLi9QaXBlbGluZS9zdGF0aWMvZGlzdCcsXG4gICAgZW1wdHlPdXREaXI6IHRydWUsXG4gIH0sXG59KVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFtVyxTQUFTLG9CQUFvQjtBQUNoWSxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBRmpCLElBQU0sbUNBQW1DO0FBSXpDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUVBLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxNQUNMLFlBQWM7QUFBQSxNQUNkLFVBQWM7QUFBQSxNQUNkLGFBQWM7QUFBQSxNQUNkLFFBQWM7QUFBQSxJQUNoQjtBQUFBLEVBQ0Y7QUFBQTtBQUFBO0FBQUEsRUFHQSxPQUFPO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixhQUFhO0FBQUEsRUFDZjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
