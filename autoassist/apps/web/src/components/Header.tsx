import React from 'react'
import { Link } from 'react-router-dom'

interface HeaderProps {
  isConnected: boolean
}

function Header({ isConnected }: HeaderProps) {
  return (
    <header className="bg-white shadow-sm border-b">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-2xl font-bold text-primary-900">
              AutoAssist+
            </h1>
            <span className="text-sm text-gray-500">
              Сервісно-страхова платформа
            </span>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div 
                className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-green-400' : 'bg-red-400'
                }`}
              />
              <span className="text-sm text-gray-600">
                {isConnected ? 'Підключено' : 'Відключено'}
              </span>
            </div>
            
            <nav className="flex space-x-4">
              <Link to="/" className="text-primary-600 hover:text-primary-700 font-medium">Нова заявка</Link>
              <Link to="/orders" className="text-gray-600 hover:text-primary-700 font-medium">Заявки</Link>
              <Link to="/demo" className="text-gray-600 hover:text-primary-700 font-medium">Demo</Link>
            </nav>
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header