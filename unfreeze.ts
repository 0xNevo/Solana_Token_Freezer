import { createThawAccountInstruction, getAssociatedTokenAddress } from "@solana/spl-token"
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js"
import base58 from "bs58"
import { ADDRESS_TO_UNFREEZE, MAIN_KP, MINT, RPC } from "./consts"


const unfreeze = async () => {
  try {
    const connection = new Connection(RPC)
    const tokenMint = new PublicKey(MINT)
    const wallet_to_unfreeze = new PublicKey(ADDRESS_TO_UNFREEZE)
    const mainKp = Keypair.fromSecretKey(base58.decode(MAIN_KP))
    // const ata = await getAssociatedTokenAddress(tokenMint, wallet_to_unfreeze)
    const ata = new PublicKey("8adayGtFQeCUWsz55JivCQxy5Q3boVLPJeTAr8HBNhUg")
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 13_000 }),
      createThawAccountInstruction(ata, tokenMint, mainKp.publicKey)
    )

    sendAndConfirmTransaction(connection, tx, [mainKp], { skipPreflight: true })
      .then(sig => console.log(`============>>>>>   Successfully unfreezed: https://solscan.io/tx/${sig}`))
  } catch (error) {
    console.log("Error in unfreezing ", error)
  }
}

unfreeze()