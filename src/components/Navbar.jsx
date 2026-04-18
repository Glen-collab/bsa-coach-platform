import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import useMediaQuery from '../hooks/useMediaQuery';

const buildStyles = (isMobile) => ({
  nav: {
    background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
    padding: isMobile ? '0 12px' : '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: isMobile ? '52px' : '60px',
    gap: '8px',
  },
  brand: {
    color: '#B37602',
    fontSize: isMobile ? '14px' : '20px',
    fontWeight: '800',
    textDecoration: 'none',
    letterSpacing: '0.3px',
    whiteSpace: 'nowrap',
    flex: '0 0 auto',
  },
  links: {
    display: 'flex',
    gap: isMobile ? '6px' : '16px',
    alignItems: 'center',
    minWidth: 0,
    flexWrap: 'nowrap',
  },
  link: {
    color: '#ccc',
    fontSize: isMobile ? '12px' : '14px',
    textDecoration: 'none',
    fontWeight: '500',
    whiteSpace: 'nowrap',
  },
  userName: {
    color: '#666',
    fontSize: isMobile ? '11px' : '13px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: isMobile ? '60px' : '160px',
  },
  btn: {
    padding: isMobile ? '6px 10px' : '8px 16px',
    borderRadius: '8px',
    border: 'none',
    fontSize: isMobile ? '11px' : '13px',
    fontWeight: '600',
    cursor: 'pointer',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    flex: '0 0 auto',
  },
  btnGold: { background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff' },
  btnOutline: { background: 'transparent', color: '#B37602', border: '1px solid #B37602' },
});

export default function Navbar() {
  const isMobile = useMediaQuery('(max-width: 640px)');
  const s = buildStyles(isMobile);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // On mobile, use an acronym for the brand to save space.
  const brandLabel = isMobile ? 'BSA' : 'Be Strong Again';

  return (
    <nav style={s.nav}>
      <Link to="/" style={s.brand}>{brandLabel}</Link>
      <div style={s.links}>
        {user ? (
          <>
            <Link to="/dashboard" style={s.link}>Dashboard</Link>
            {user.role === 'admin' && <Link to="/admin" style={s.link}>Admin</Link>}
            {!isMobile && <span style={s.userName}>{user.first_name || user.email}</span>}
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
