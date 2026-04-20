import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Navbar from './components/Navbar';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import MemberDashboard from './pages/MemberDashboard';
import CoachDashboard from './pages/CoachDashboard';
import AdminDashboard from './pages/AdminDashboard';
import ApplyCoach from './pages/ApplyCoach';
import MediaLibrary from './pages/MediaLibrary';
import GymTV from './pages/GymTV';

function ProtectedRoute({ children, requiredRole }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ textAlign: 'center', padding: '60px', color: '#666' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (requiredRole && user.role !== requiredRole && user.role !== 'admin') return <Navigate to="/dashboard" />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();

  const getDashboard = () => {
    if (!user) return <Navigate to="/login" />;
    if (user.role === 'admin') return <AdminDashboard />;
    if (user.role === 'coach') return <CoachDashboard />;
    return <MemberDashboard />;
  };

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/register/:referralCode" element={<Register />} />
      <Route path="/dashboard" element={<ProtectedRoute>{getDashboard()}</ProtectedRoute>} />
      <Route path="/coach" element={<ProtectedRoute requiredRole="coach"><CoachDashboard /></ProtectedRoute>} />
      <Route path="/apply-coach" element={<ApplyCoach />} />
      <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminDashboard /></ProtectedRoute>} />
      <Route path="/media-library" element={<ProtectedRoute><MediaLibrary /></ProtectedRoute>} />
      <Route path="/gym-tv" element={<ProtectedRoute><GymTV /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
