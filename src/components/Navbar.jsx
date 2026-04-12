import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const s = {
  nav: { background: 'linear-gradient(135deg, #1a1a2e, #16213e)', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '60px' },
  brand: { color: '#B37602', fontSize: '20px', fontWeight: '800', textDecoration: 'none', letterSpacing: '0.5px' },
  links: { display: 'flex', gap: '16px', alignItems: 'center' },
  link: { color: '#ccc', fontSize: '14px', textDecoration: 'none', fontWeight: '500' },
  btn: { padding: '8px 16px', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer', textDecoration: 'none' },
  btnGold: { background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff' },
  btnOutline: { background: 'transparent', color: '#B37602', border: '1px solid #B37602' },
};

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <nav style={s.nav}>
      <Link to="/" style={s.brand}>Be Strong Again</Link>
      <div style={s.links}>
        {user ? (
          <>
            <Link to="/dashboard" style={s.link}>Dashboard</Link>
            {user.role === 'admin' && <Link to="/admin" style={s.link}>Admin</Link>}
            <span style={{ color: '#666', fontSize: '13px' }}>{user.first_name || user.email}</span>
            <button onClick={() => { logout(); navigate('/'); }} style={{ ...s.btn, ...s.btnOutline }}>Logout</button>
          </>
        ) : (
          <>
            <Link to="/login" style={s.link}>Login</Link>
            <Link to="/register" style={{ ...s.btn, ...s.btnGold, textDecoration: 'none' }}>Get Started</Link>
          </>
        )}
      </div>
    </nav>
  );
}
