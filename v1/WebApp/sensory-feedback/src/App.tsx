import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Navbar } from '@/components/Navbar'
import { Home } from '@/pages/Home'
import { Sensors } from '@/pages/Sensors'
import { Record } from '@/pages/Record'
import { View } from '@/pages/View'
import './App.css'

function App() {
  return (
    <Router>
      <Navbar />
      <div className="container mx-auto p-4 pb-24">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sensors" element={<Sensors />} />
          <Route path="/record" element={<Record />} />
          <Route path="/view" element={<View />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App
