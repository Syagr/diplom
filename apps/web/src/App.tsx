import React from 'react'
import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { Box, Container, Flex, HStack, Heading, Spacer, Button, Badge } from '@chakra-ui/react'
import { useAuth } from '@shared/hooks/useAuth'
import DashboardPage from '@features/dashboard/DashboardPage'
import LoginPage from '@features/auth/LoginPage'
import OrdersListPage from '@features/orders/OrdersListPage'
import OrderDetailPage from '@features/orders/OrderDetailPage'
import NewOrderWizard from '@features/orders/NewOrderWizard'
import PaymentPage from '@features/payments/PaymentPage'
import NotificationsPage from '@features/notifications/NotificationsPage'
import ReceiptsPage from '@features/receipts/ReceiptsPage'
import BoardPage from '@features/admin/BoardPage'
import OrderDetailAdminPage from '@features/admin/OrderDetailAdminPage'
import CalcProfilesPage from '@features/admin/CalcProfilesPage'
import ServiceCentersPage from '@features/admin/ServiceCentersPage'
import BroadcastPage from '@features/admin/BroadcastPage'

function Protected({ children, role }: { children: JSX.Element; role?: 'customer' | 'service_manager' | 'admin' }) {
	const { user } = useAuth()
	if (!user) return <Navigate to="/login" replace />
	if (role && user.role !== role) return <Navigate to="/" replace />
	return children
}

function Nav() {
	const { user, logout } = useAuth()
	return (
		<Box borderBottomWidth="1px" mb={4}>
			<Container maxW="6xl" py={3}>
				<Flex align="center" gap={4}>
					<Heading size="md"><Link to="/">AutoAssist</Link></Heading>
					<HStack as="nav" spacing={4}>
						{user && (
							<>
								<Link to="/dashboard">Дашборд</Link>
								<Link to="/orders">Заявки</Link>
								<Link to="/orders/new">Новая</Link>
								<Link to="/notifications">Уведомления <Badge ml={1}>0</Badge></Link>
								<Link to="/receipts">Чеки</Link>
								{user.role !== 'customer' && (
									<>
										<Link to="/admin/board">Борда</Link>
										<Link to="/admin/calc-profiles">Профили</Link>
										<Link to="/admin/service-centers">Сервисы</Link>
										<Link to="/admin/broadcast">Broadcast</Link>
									</>
								)}
							</>
						)}
					</HStack>
					<Spacer />
					<HStack>
						{user ? (
							<>
								<Badge>{user.role}</Badge>
								<Button size="sm" onClick={logout}>Выйти</Button>
							</>
						) : (
							<Button as={Link} to="/login" size="sm">Войти</Button>
						)}
					</HStack>
				</Flex>
			</Container>
		</Box>
	)
}

export function App() {
	return (
		<>
			<Nav />
			<Container maxW="6xl" pb={12}>
				<Routes>
					<Route path="/" element={<Navigate to="/dashboard" replace />} />
					<Route path="/login" element={<LoginPage />} />
					<Route path="/dashboard" element={<Protected><DashboardPage /></Protected>} />
					<Route path="/orders" element={<Protected><OrdersListPage /></Protected>} />
					<Route path="/orders/new" element={<Protected><NewOrderWizard /></Protected>} />
					<Route path="/orders/:id" element={<Protected><OrderDetailPage /></Protected>} />
					<Route path="/payments/:orderId" element={<Protected><PaymentPage /></Protected>} />
					<Route path="/notifications" element={<Protected><NotificationsPage /></Protected>} />
					<Route path="/receipts" element={<Protected><ReceiptsPage /></Protected>} />
					<Route path="/admin/board" element={<Protected role="service_manager"><BoardPage /></Protected>} />
					<Route path="/admin/orders/:id" element={<Protected role="service_manager"><OrderDetailAdminPage /></Protected>} />
					<Route path="/admin/calc-profiles" element={<Protected role="admin"><CalcProfilesPage /></Protected>} />
					<Route path="/admin/service-centers" element={<Protected role="admin"><ServiceCentersPage /></Protected>} />
					<Route path="/admin/broadcast" element={<Protected role="admin"><BroadcastPage /></Protected>} />
					<Route path="*" element={<Navigate to="/dashboard" replace />} />
				</Routes>
			</Container>
		</>
	)
}

export default App

