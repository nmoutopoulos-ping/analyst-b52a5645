import { Toaster } from './components/ui/sonner';
import { RentCastComps } from './components/RentCastComps';

export default function App() {
  return (
    <div className="size-full flex items-center justify-center bg-slate-200 p-4">
      <RentCastComps />
      <Toaster position="top-right" />
    </div>
  );
}