import { ethers } from 'ethers';
const RPC = process.env.WEB3_RPC_URL || '';
const PK = process.env.WEB3_PRIVATE_KEY || '';
export const provider = new ethers.JsonRpcProvider(RPC);
export const wallet = new ethers.Wallet(PK, provider);

// load ABI JSON without import assertions (tsconfig should enable resolveJsonModule)
let ESCROW_ABI: any = {};
try {
	// prefer static import when available; fallback to require at runtime
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	ESCROW_ABI = require('../../web3/sdk/escrow.abi.json');
} catch (e) {
	// file missing — keep empty ABI
	ESCROW_ABI = {};
}

export const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS || '';
export const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, wallet);