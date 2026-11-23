import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {initWebSocketResilience} from './lib/wsResilience';

initWebSocketResilience();

createRoot(document.getElementById('root')!).render(<App />);
