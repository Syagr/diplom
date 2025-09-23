import React, { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { io, Socket } from 'socket.io-client'
import OrderForm from './components/OrderForm'
import OrderList from './components/OrderList'
import Header from './components/Header'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080'

function App() {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const newSocket = io(WS_URL)
    setSocket(newSocket)

    newSocket.on('connect', () => {
      console.log('Connected to WebSocket')
      setIsConnected(true)
      newSocket.emit('join', 'managers')
    })

    newSocket.on('disconnect', () => {
      console.log('Disconnected from WebSocket')
      setIsConnected(false)
    })

    newSocket.on('order:new', (data) => {
      console.log('New order received:', data)
      // You can add notification logic here
    })

    return () => {
      newSocket.close()
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <Header isConnected={isConnected} />
      
      <main className="container mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<OrderForm />} />
          <Route path="/orders" element={<OrderList />} />
          <Route path="/tg" element={<TelegramWebApp />} />
        </Routes>
      </main>
    </div>
  )
}

// Telegram WebApp component
function TelegramWebApp() {
  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-6">AutoAssist+ WebApp</h1>
      <OrderForm isTelegram={true} />
    </div>
  )
}

export default App