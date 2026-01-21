import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Navbar } from '@/components/Navbar'
import { Home } from '@/pages/Home'
import { Sensors } from '@/pages/Sensors'
import { View } from '@/pages/View'
import { ConnectionProvider } from '@/context/ConnectionContext'
import './App.css'

function App() {
  return (
    <ConnectionProvider>
      <Router>
        <Navbar />
        <div className="container mx-auto p-4 pb-24">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/sensors" element={<Sensors />} />
            <Route path="/view" element={<View />} />
          </Routes>
        </div>
      </Router>
    </ConnectionProvider>
  )
}

export default App
