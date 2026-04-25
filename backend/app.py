"""
BeStrongAgain Coach Platform - Main Flask App
"""
import os
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-change-me')

# CORS — allow all origins (workout builder/tracker on Netlify + WordPress)
CORS(app, origins='*')

# ── Database connection helper ──
import psycopg2
from psycopg2.extras import RealDictCursor

def get_db():
    return psycopg2.connect(
        os.environ['DATABASE_URL'],
        cursor_factory=RealDictCursor,
    )

# Make get_db available to blueprints
app.get_db = get_db

# ── Register route blueprints ──
from auth import auth_bp
from stripe_routes import stripe_bp
from coaches import coaches_bp
from admin import admin_bp
from workout_api import workout_bp
from media import media_bp
from kiosk import kiosk_bp
from cast import cast_bp
from social import social_bp

app.register_blueprint(auth_bp, url_prefix='/api/auth')
app.register_blueprint(stripe_bp, url_prefix='/api/stripe')
app.register_blueprint(coaches_bp, url_prefix='/api/coaches')
app.register_blueprint(admin_bp, url_prefix='/api/admin')
app.register_blueprint(workout_bp, url_prefix='/api/workout')
app.register_blueprint(media_bp, url_prefix='/api/media')
app.register_blueprint(kiosk_bp, url_prefix='/api/kiosk')
app.register_blueprint(cast_bp, url_prefix='/api/cast')
app.register_blueprint(social_bp, url_prefix='/api/social')

@app.route('/api/health')
def health():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT 1')
        cur.close()
        conn.close()
        return {'status': 'ok', 'db': 'connected'}
    except Exception as e:
        return {'status': 'error', 'db': str(e)}, 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=os.environ.get('FLASK_ENV') == 'development')
