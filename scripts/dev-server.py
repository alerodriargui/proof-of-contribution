import http.server
import os
import re
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def translate_path(self, path):
        if re.match(r"^/contributors/", path):
            path = "/contributors/index.html"
        return super().translate_path(path)

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {args[0]} {args[1]} {args[2]}")


if __name__ == "__main__":
    httpd = http.server.HTTPServer(("0.0.0.0", PORT), DevHandler)
    print(f"Serving at http://localhost:{PORT}")
    print(f"Rewrite: /contributors/* -> /contributors/index.html")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        httpd.server_close()
