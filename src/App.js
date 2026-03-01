import { useState } from 'react';
import Auth from './components/Auth';
import Chat from './components/Chat';
import './App.css';

function App() {
  const [user, setUser] = useState(() => {
    const u = localStorage.getItem('chatapp_user');
    if (!u) return null;
    return JSON.parse(u);
  });

  const handleLogin = (username, firstName, lastName) => {
    const userData = { username, firstName: firstName || '', lastName: lastName || '' };
    localStorage.setItem('chatapp_user', JSON.stringify(userData));
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('chatapp_user');
    setUser(null);
  };

  if (user) {
    return <Chat username={user.username} firstName={user.firstName} lastName={user.lastName} onLogout={handleLogout} />;
  }
  return <Auth onLogin={handleLogin} />;
}

export default App;
