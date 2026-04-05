import React, { useState, useEffect } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  OperationType, 
  handleFirestoreError 
} from './lib/firebase';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  doc, 
  getDoc, 
  setDoc,
  orderBy
} from 'firebase/firestore';
import { 
  Scissors, 
  Calendar, 
  Clock, 
  User as UserIcon, 
  LogOut, 
  CheckCircle, 
  XCircle, 
  ChevronRight,
  Menu,
  X,
  Settings,
  Phone,
  Mail,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfToday, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface Booking {
  id: string;
  userId?: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  date: string;
  time: string;
  service: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

interface UserProfile {
  email: string;
  displayName: string;
  role: 'user' | 'admin';
}

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setHasError(true);
      setErrorMessage(event.message);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Упс! Что-то пошло не так</h2>
          <p className="text-gray-600 mb-6">{errorMessage}</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 transition-colors"
          >
            Перезагрузить страницу
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [allBookings, setAllBookings] = useState<Booking[]>([]);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [localBookingIds, setLocalBookingIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('olya_bookings');
    return saved ? JSON.parse(saved) : [];
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'admin' | 'my-bookings'>('home');
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        let profile: UserProfile;
        if (!userDoc.exists()) {
          const isAdmin = 
            currentUser.email === 'bubinadubina5@gmail.com' || 
            currentUser.email?.includes('olgatokareva');
          
          profile = {
            email: currentUser.email || '',
            displayName: currentUser.displayName || 'Гость',
            role: isAdmin ? 'admin' : 'user'
          };
          await setDoc(userDocRef, profile);
        } else {
          profile = userDoc.data() as UserProfile;
        }
        setUserProfile(profile);
      } else {
        setUserProfile(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Local Storage Sync
  useEffect(() => {
    localStorage.setItem('olya_bookings', JSON.stringify(localBookingIds));
  }, [localBookingIds]);

  // My Bookings Listener
  useEffect(() => {
    if (!isAuthReady) return;

    // If no local IDs and no user, clear my bookings
    if (localBookingIds.length === 0 && !user) {
      setMyBookings([]);
      return;
    }

    let unsubscribes: (() => void)[] = [];

    if (user) {
      // Logged in user: query by userId
      const q = query(
        collection(db, 'bookings'),
        orderBy('createdAt', 'desc')
      );
      const unsub = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as Booking))
          .filter(b => b.userId === user.uid);
        setMyBookings(data);
      });
      unsubscribes.push(unsub);
    } else if (localBookingIds.length > 0) {
      // Guest: fetch individual docs by ID
      // We'll use a simple approach: listen to each doc
      const currentBookings: { [id: string]: Booking } = {};
      
      localBookingIds.forEach(id => {
        const unsub = onSnapshot(doc(db, 'bookings', id), (docSnap) => {
          if (docSnap.exists()) {
            currentBookings[id] = { id: docSnap.id, ...docSnap.data() } as Booking;
          } else {
            delete currentBookings[id];
            // Also remove from local storage if it's gone from Firestore
            setLocalBookingIds(prev => prev.filter(pid => pid !== id));
          }
          setMyBookings(Object.values(currentBookings).sort((a, b) => 
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          ));
        });
        unsubscribes.push(unsub);
      });
    }

    return () => unsubscribes.forEach(unsub => unsub());
  }, [user, localBookingIds, isAuthReady]);

  // All Bookings Listener (Admin)
  useEffect(() => {
    if (!userProfile || userProfile.role !== 'admin' || !isAuthReady) return;

    const q = query(
      collection(db, 'bookings'),
      orderBy('date', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Booking));
      setAllBookings(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'bookings');
    });

    return () => unsubscribe();
  }, [userProfile, isAuthReady]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setActiveTab('home');
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <Scissors className="w-12 h-12 text-stone-800" />
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-stone-50 font-sans text-stone-900">
        {/* Navigation */}
        <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-stone-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16 items-center">
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => setActiveTab('home')}>
                <Scissors className="w-8 h-8 text-stone-800" />
                <span className="text-xl font-bold tracking-tight uppercase">Оля-ля</span>
              </div>

              <div className="hidden md:flex items-center gap-8">
                <button onClick={() => setActiveTab('home')} className={cn("text-sm font-medium transition-colors", activeTab === 'home' ? "text-stone-900" : "text-stone-500 hover:text-stone-900")}>Главная</button>
                
                <button onClick={() => setActiveTab('my-bookings')} className={cn("text-sm font-medium transition-colors relative", activeTab === 'my-bookings' ? "text-stone-900" : "text-stone-500 hover:text-stone-900")}>
                  Мои записи
                  {myBookings.length > 0 && (
                    <span className="absolute -top-2 -right-4 bg-stone-900 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                      {myBookings.length}
                    </span>
                  )}
                </button>

                {userProfile?.role === 'admin' && (
                  <button onClick={() => setActiveTab('admin')} className={cn("text-sm font-medium transition-colors flex items-center gap-1", activeTab === 'admin' ? "text-stone-900" : "text-stone-500 hover:text-stone-900")}>
                    <Settings className="w-4 h-4" />
                    Админ-панель
                  </button>
                )}

                <button 
                  onClick={() => setIsBookingModalOpen(true)}
                  className="bg-stone-900 text-white px-6 py-2 rounded-full text-sm font-medium hover:bg-stone-800 transition-all shadow-lg shadow-stone-200"
                >
                  Записаться
                </button>

                {user && (
                  <div className="flex items-center gap-4 border-l border-stone-200 pl-8">
                    <div className="flex items-center gap-2">
                      <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-stone-200" referrerPolicy="no-referrer" />
                      <span className="text-sm font-medium">{user.displayName}</span>
                    </div>
                    <button onClick={handleLogout} className="text-stone-500 hover:text-red-600 transition-colors">
                      <LogOut className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Mobile Menu Button */}
              <div className="md:hidden flex items-center gap-4">
                <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="text-stone-900">
                  {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
              </div>
            </div>
          </div>

          {/* Mobile Menu */}
          <AnimatePresence>
            {isMenuOpen && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="md:hidden bg-white border-b border-stone-200"
              >
                <div className="px-4 pt-2 pb-6 space-y-2">
                  <button onClick={() => { setActiveTab('home'); setIsMenuOpen(false); }} className="block w-full text-left px-4 py-3 text-base font-medium text-stone-900 hover:bg-stone-50 rounded-xl">Главная</button>
                  <button onClick={() => { setActiveTab('my-bookings'); setIsMenuOpen(false); }} className="block w-full text-left px-4 py-3 text-base font-medium text-stone-900 hover:bg-stone-50 rounded-xl">Мои записи</button>
                  <button onClick={() => { setIsBookingModalOpen(true); setIsMenuOpen(false); }} className="block w-full text-left px-4 py-3 text-base font-medium text-stone-900 hover:bg-stone-50 rounded-xl">Записаться</button>
                  {userProfile?.role === 'admin' && (
                    <button onClick={() => { setActiveTab('admin'); setIsMenuOpen(false); }} className="block w-full text-left px-4 py-3 text-base font-medium text-stone-900 hover:bg-stone-50 rounded-xl">Админ-панель</button>
                  )}
                  {user && (
                    <button onClick={() => { handleLogout(); setIsMenuOpen(false); }} className="block w-full text-left px-4 py-3 text-base font-medium text-red-600 hover:bg-red-50 rounded-xl">Выйти</button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </nav>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {activeTab === 'home' && <HomeView onBookNow={() => setIsBookingModalOpen(true)} />}
          {activeTab === 'my-bookings' && <MyBookingsView bookings={myBookings} onBookNow={() => setIsBookingModalOpen(true)} />}
          {activeTab === 'admin' && userProfile?.role === 'admin' && <AdminView bookings={allBookings} />}
        </main>

        {/* Footer */}
        <footer className="bg-stone-900 text-stone-400 py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Scissors className="w-6 h-6 text-white" />
              <span className="text-lg font-bold text-white tracking-tight">ОЛЯ-ЛЯ</span>
            </div>
            <p className="text-sm mb-8">Премиальный уход для современного мужчины.</p>
            <div className="flex justify-center gap-8 text-xs uppercase tracking-widest mb-12">
              <span>Instagram</span>
              <span>Facebook</span>
              <span>Twitter</span>
            </div>
            
            {!user && (
              <button 
                onClick={handleLogin}
                className="text-stone-600 hover:text-stone-400 text-xs transition-colors mb-8 block mx-auto"
              >
                Вход для персонала
              </button>
            )}

            <div className="pt-8 border-t border-stone-800 text-[10px]">
              &copy; 2026 ОЛЯ-ЛЯ. ВСЕ ПРАВА ЗАЩИЩЕНЫ.
            </div>
          </div>
        </footer>

        {/* Booking Modal */}
        <BookingModal 
          isOpen={isBookingModalOpen} 
          onClose={() => setIsBookingModalOpen(false)} 
          onSuccess={(id) => setLocalBookingIds(prev => [...prev, id])}
          userId={user?.uid}
        />
      </div>
    </ErrorBoundary>
  );
}

// --- Components ---

function BookingModal({ isOpen, onClose, onSuccess, userId }: { isOpen: boolean, onClose: () => void, onSuccess: (id: string) => void, userId?: string }) {
  const [selectedService, setSelectedService] = useState('Стрижка');
  const [selectedDate, setSelectedDate] = useState(format(startOfToday(), 'yyyy-MM-dd'));
  const [selectedTime, setSelectedTime] = useState('10:00');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const docRef = await addDoc(collection(db, 'bookings'), {
        userId: userId || null,
        userName: name,
        userPhone: phone,
        userEmail: email,
        date: selectedDate,
        time: selectedTime,
        service: selectedService,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      onSuccess(docRef.id);
      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        onClose();
        setName('');
        setPhone('');
        setEmail('');
      }, 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'bookings');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white w-full max-w-lg rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto mt-auto md:mt-0"
          >
            {isSuccess ? (
              <div className="p-12 text-center space-y-4">
                <div className="w-20 h-20 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-12 h-12" />
                </div>
                <h3 className="text-2xl font-bold">Запись создана!</h3>
                <p className="text-stone-500">Мы свяжемся с вами для подтверждения в ближайшее время.</p>
              </div>
            ) : (
              <>
                <div className="p-6 md:p-8 border-b border-stone-100 flex justify-between items-center sticky top-0 bg-white z-10">
                  <div>
                    <h3 className="text-xl md:text-2xl font-bold">Записаться</h3>
                    <p className="text-stone-500 text-xs md:text-sm">Заполните данные для бронирования.</p>
                  </div>
                  <button onClick={onClose} className="p-2 text-stone-400 hover:text-stone-900 md:hidden">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <form onSubmit={handleBooking} className="p-6 md:p-8 space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Ваше имя</label>
                      <div className="relative">
                        <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                        <input 
                          type="text" 
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Иван Иванов"
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 transition-all"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Телефон</label>
                        <div className="relative">
                          <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                          <input 
                            type="tel" 
                            required
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="+7 (999) 000-00-00"
                            className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 transition-all"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Email (опционально)</label>
                        <div className="relative">
                          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                          <input 
                            type="email" 
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="example@mail.ru"
                            className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 transition-all"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Услуга</label>
                    <select 
                      value={selectedService}
                      onChange={(e) => setSelectedService(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 transition-all"
                    >
                      <option>Стрижка</option>
                      <option>Маска для волос</option>
                      <option>Окрашивание волос</option>
                      <option>Окрашивание бровей и ресниц</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Дата</label>
                      <input 
                        type="date" 
                        min={format(startOfToday(), 'yyyy-MM-dd')}
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 transition-all"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Время</label>
                      <select 
                        value={selectedTime}
                        onChange={(e) => setSelectedTime(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900 transition-all"
                      >
                        {['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'].map(t => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-stone-900 text-white py-4 rounded-xl font-bold hover:bg-stone-800 transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? 'Отправка...' : 'Подтвердить запись'}
                  </button>
                </form>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// --- Views ---

function HomeView({ onBookNow }: { onBookNow: () => void }) {
  return (
    <div className="space-y-24">
      {/* Hero Section */}
      <section className="relative h-[600px] rounded-3xl overflow-hidden flex items-center justify-center text-center px-4">
        <img 
          src="https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&q=80&w=1920" 
          alt="Барбершоп" 
          className="absolute inset-0 w-full h-full object-cover brightness-50"
          referrerPolicy="no-referrer"
        />
        <div className="relative z-10 max-w-2xl px-4">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-7xl font-bold text-white mb-6 tracking-tight"
          >
            Четкие стрижки для ясного ума
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-xl text-stone-200 mb-10 font-light"
          >
            Испытайте искусство традиционного барберинга в сочетании с современным стилем.
          </motion.p>
          <motion.button 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            onClick={onBookNow}
            className="bg-white text-stone-900 px-10 py-4 rounded-full text-lg font-bold hover:bg-stone-100 transition-all shadow-2xl"
          >
            Записаться
          </motion.button>
        </div>
      </section>

      {/* Services Section */}
      <section>
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold mb-4">Наши услуги</h2>
          <div className="w-12 h-1 bg-stone-900 mx-auto"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            { title: 'Стрижки', price: 'от 1500 ₽', desc: 'Профессиональные стрижки любой сложности для создания вашего идеального образа.' },
            { title: 'Маски для волос', price: 'от 1000 ₽', desc: 'Глубокое восстановление и питание ваших волос с использованием премиальных средств.' },
            { title: 'Окрашивание волос', price: 'от 3000 ₽', desc: 'Стильное окрашивание: от классики до современных техник (омбре, балаяж).' },
            { title: 'Брови и ресницы', price: 'от 800 ₽', desc: 'Профессиональное окрашивание бровей и ресниц для выразительного взгляда.' }
          ].map((service, i) => (
            <motion.div 
              key={i}
              whileHover={{ y: -10 }}
              className="bg-white p-8 rounded-2xl border border-stone-100 shadow-sm hover:shadow-xl transition-all"
            >
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-bold">{service.title}</h3>
                <span className="text-stone-500 font-mono">{service.price}</span>
              </div>
              <p className="text-stone-600 leading-relaxed">{service.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* About Section */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
        <div className="relative">
          <img 
            src="https://images.unsplash.com/photo-1585747860715-2ba37e788b70?auto=format&fit=crop&q=80&w=800" 
            alt="Барбер за работой" 
            className="rounded-3xl shadow-2xl"
            referrerPolicy="no-referrer"
          />
          <div className="absolute -bottom-8 -right-8 bg-stone-900 text-white p-8 rounded-2xl hidden lg:block">
            <p className="text-2xl font-bold mb-1">15+</p>
            <p className="text-xs uppercase tracking-widest text-stone-400">Лет мастерства</p>
          </div>
        </div>
        <div className="space-y-6">
          <h2 className="text-4xl font-bold tracking-tight">Традиции встречают совершенство</h2>
          <p className="text-lg text-stone-600 leading-relaxed">
            Основанная в 2010 году, парикмахерская «Оля-ля» стала краеугольным камнем стиля в нашем сообществе. Мы верим, что стрижка — это больше, чем просто услуга, это опыт, который оставляет вас уверенным и обновленным.
          </p>
          <ul className="space-y-4">
            {['Экспертные барберы', 'Премиальные продукты', 'Расслабленная атмосфера', 'Онлайн-запись'].map((item, i) => (
              <li key={i} className="flex items-center gap-3 text-stone-800 font-medium">
                <CheckCircle className="w-5 h-5 text-stone-400" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function MyBookingsView({ bookings, onBookNow }: { bookings: Booking[], onBookNow: () => void }) {
  const [bookingToCancel, setBookingToCancel] = useState<string | null>(null);

  const handleCancelConfirm = async () => {
    if (!bookingToCancel) return;
    try {
      await deleteDoc(doc(db, 'bookings', bookingToCancel));
      setBookingToCancel(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'bookings');
    }
  };

  return (
    <div className="space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold mb-2">Мои записи</h2>
          <p className="text-stone-500">Здесь отображаются ваши текущие и прошлые записи.</p>
        </div>
        {bookings.length > 0 && (
          <button 
            onClick={onBookNow}
            className="bg-stone-900 text-white px-8 py-3 rounded-full text-sm font-bold hover:bg-stone-800 transition-all shadow-lg"
          >
            Новая запись
          </button>
        )}
      </div>

      {bookings.length === 0 ? (
        <div className="bg-white rounded-3xl border border-stone-100 p-16 text-center space-y-6">
          <div className="w-20 h-20 bg-stone-50 text-stone-300 rounded-full flex items-center justify-center mx-auto">
            <Calendar className="w-10 h-10" />
          </div>
          <div className="max-w-xs mx-auto">
            <h3 className="text-xl font-bold mb-2">У вас пока нет записей</h3>
            <p className="text-stone-500 text-sm mb-8">Запишитесь на стрижку прямо сейчас, и она появится здесь.</p>
            <button 
              onClick={onBookNow}
              className="w-full bg-stone-900 text-white py-4 rounded-xl font-bold hover:bg-stone-800 transition-all"
            >
              Записаться
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {bookings.map((booking) => (
            <motion.div 
              key={booking.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm space-y-6 relative overflow-hidden"
            >
              <div className="flex justify-between items-start">
                <div className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                  booking.status === 'pending' ? "bg-amber-50 text-amber-600" : 
                  booking.status === 'accepted' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                )}>
                  {booking.status === 'pending' ? 'Ожидание' : booking.status === 'accepted' ? 'Принята' : 'Отклонена'}
                </div>
                <button 
                  onClick={() => setBookingToCancel(booking.id)}
                  className="text-stone-300 hover:text-red-500 transition-colors"
                  title="Отменить запись"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-stone-50 rounded-2xl flex items-center justify-center text-stone-800">
                    <Scissors className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-stone-400">Услуга</p>
                    <p className="font-bold">{booking.service}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-stone-400" />
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Дата</p>
                      <p className="text-sm font-medium">{format(parseISO(booking.date), 'd MMM yyyy', { locale: ru })}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-stone-400" />
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Время</p>
                      <p className="text-sm font-medium">{booking.time}</p>
                    </div>
                  </div>
                </div>
              </div>

              {booking.status === 'pending' && (
                <div className="pt-4 border-t border-stone-50">
                  <p className="text-[10px] text-stone-400 italic text-center">
                    Мастер скоро подтвердит вашу запись.
                  </p>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      <AnimatePresence>
        {bookingToCancel && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setBookingToCancel(null)}
              className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 text-center"
            >
              <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <XCircle className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-2">Отменить запись?</h3>
              <p className="text-stone-500 text-sm mb-8">
                Вы действительно хотите отменить вашу запись? Это действие нельзя отменить.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setBookingToCancel(null)}
                  className="flex-1 px-6 py-3 bg-stone-100 text-stone-600 rounded-xl font-bold hover:bg-stone-200 transition-all"
                >
                  Назад
                </button>
                <button 
                  onClick={handleCancelConfirm}
                  className="flex-1 px-6 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200"
                >
                  Отменить
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AdminView({ bookings }: { bookings: Booking[] }) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');
  const [bookingToDelete, setBookingToDelete] = useState<string | null>(null);

  const filteredBookings = bookings.filter(b => filter === 'all' || b.status === filter);

  const updateStatus = async (id: string, status: Booking['status']) => {
    try {
      await updateDoc(doc(db, 'bookings', id), { status });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'bookings');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!bookingToDelete) return;
    try {
      await deleteDoc(doc(db, 'bookings', bookingToDelete));
      setBookingToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'bookings');
    }
  };

  return (
    <div className="space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold mb-2">Админ-панель</h2>
          <p className="text-stone-500">Обзор всех записей в барбершопе.</p>
        </div>
        <div className="flex bg-white p-1 rounded-xl border border-stone-200">
          {[
            { id: 'all', label: 'Все' },
            { id: 'pending', label: 'Ожидают' },
            { id: 'accepted', label: 'Приняты' },
            { id: 'rejected', label: 'Отклонены' }
          ].map((f) => (
            <button 
              key={f.id}
              onClick={() => setFilter(f.id as any)}
              className={cn(
                "px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                filter === f.id ? "bg-stone-900 text-white shadow-lg" : "text-stone-500 hover:text-stone-900"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-stone-100 shadow-sm overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-100">
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-stone-400">Клиент</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-stone-400">Услуга</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-stone-400">Дата и время</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-stone-400">Статус</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-stone-400 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {filteredBookings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-stone-400 italic">Записей не найдено для этого фильтра.</td>
                </tr>
              ) : (
                filteredBookings.map((booking) => (
                  <tr key={booking.id} className="hover:bg-stone-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-stone-100 rounded-full flex items-center justify-center text-stone-400">
                          <UserIcon className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="font-bold text-sm">{booking.userName}</p>
                          <p className="text-xs text-stone-500">{booking.userPhone}</p>
                          {booking.userEmail && <p className="text-[10px] text-stone-400">{booking.userEmail}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium">{booking.service}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm">
                        <p className="font-medium">{format(parseISO(booking.date), 'd MMM yyyy', { locale: ru })}</p>
                        <p className="text-stone-500">{booking.time}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                        booking.status === 'pending' ? "bg-amber-50 text-amber-600" : 
                        booking.status === 'accepted' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                      )}>
                        {booking.status === 'pending' ? 'Ожидание' : booking.status === 'accepted' ? 'Принята' : 'Отклонена'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {booking.status === 'pending' && (
                          <>
                            <button 
                              onClick={() => updateStatus(booking.id, 'accepted')}
                              className="p-2 text-stone-400 hover:text-green-600 transition-colors"
                              title="Принять"
                            >
                              <CheckCircle className="w-5 h-5" />
                            </button>
                            <button 
                              onClick={() => updateStatus(booking.id, 'rejected')}
                              className="p-2 text-stone-400 hover:text-amber-600 transition-colors"
                              title="Отклонить"
                            >
                              <XCircle className="w-5 h-5" />
                            </button>
                            <button 
                              onClick={() => setBookingToDelete(booking.id)}
                              className="p-2 text-stone-400 hover:text-red-600 transition-colors"
                              title="Удалить (без следа)"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </>
                        )}
                        {booking.status !== 'pending' && (
                           <button 
                            onClick={() => setBookingToDelete(booking.id)}
                            className="p-2 text-stone-400 hover:text-red-600 transition-colors"
                            title="Удалить (без следа)"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-stone-100">
          {filteredBookings.length === 0 ? (
            <div className="px-6 py-12 text-center text-stone-400 italic">Записей не найдено для этого фильтра.</div>
          ) : (
            filteredBookings.map((booking) => (
              <div key={booking.id} className="p-6 space-y-4">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center text-stone-400">
                      <UserIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold">{booking.userName}</p>
                      <p className="text-xs text-stone-500">{booking.userPhone}</p>
                    </div>
                  </div>
                  <span className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                    booking.status === 'pending' ? "bg-amber-50 text-amber-600" : 
                    booking.status === 'accepted' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                  )}>
                    {booking.status === 'pending' ? 'Ожидание' : booking.status === 'accepted' ? 'Принята' : 'Отклонена'}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-1">Услуга</p>
                    <p className="font-medium">{booking.service}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-1">Дата и время</p>
                    <p className="font-medium">{format(parseISO(booking.date), 'd MMM yyyy', { locale: ru })}</p>
                    <p className="text-stone-500">{booking.time}</p>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  {booking.status === 'pending' && (
                    <>
                      <button 
                        onClick={() => updateStatus(booking.id, 'accepted')}
                        className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-600 rounded-xl text-xs font-bold"
                      >
                        <CheckCircle className="w-4 h-4" /> Принять
                      </button>
                      <button 
                        onClick={() => updateStatus(booking.id, 'rejected')}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-600 rounded-xl text-xs font-bold"
                      >
                        <XCircle className="w-4 h-4" /> Отклонить
                      </button>
                    </>
                  )}
                  <button 
                    onClick={() => setBookingToDelete(booking.id)}
                    className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-xs font-bold"
                  >
                    <Trash2 className="w-4 h-4" /> Удалить
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {bookingToDelete && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setBookingToDelete(null)}
              className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 text-center"
            >
              <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-2">Удалить запись?</h3>
              <p className="text-stone-500 text-sm mb-8">
                Это действие нельзя отменить. Запись будет удалена безвозвратно.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setBookingToDelete(null)}
                  className="flex-1 px-6 py-3 bg-stone-100 text-stone-600 rounded-xl font-bold hover:bg-stone-200 transition-all"
                >
                  Отмена
                </button>
                <button 
                  onClick={handleDeleteConfirm}
                  className="flex-1 px-6 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200"
                >
                  Удалить
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
