import { ethers } from 'ethers';
const RPC = process.env.WEB3_RPC_URL!;
const PK = process.env.WEB3_PRIVATE_KEY!;
export const provider = new ethers.JsonRpcProvider(RPC);
export const wallet = new ethers.Wallet(PK, provider);

// загрузи ABI своих контрактов (простая заглушка)
import ESCROW_ABI from '../../web3/sdk/escrow.abi.json' assert { type: 'json' };
export const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS!;
export const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, wallet);