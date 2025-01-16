import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js"
import { MAINNET_PROGRAM_ID, LIQUIDITY_STATE_LAYOUT_V4, SPL_ACCOUNT_LAYOUT } from "@raydium-io/raydium-sdk"
import { NATIVE_MINT, TOKEN_PROGRAM_ID, createFreezeAccountInstruction, getAssociatedTokenAddress } from "@solana/spl-token"
import base58 from "bs58"
import { COMMITMENT_LEVEL, DOUBLE_CHECK_INTERVAL, MAIN_KP, MINT, RPC, WSS } from "./consts"
import { readJson, saveDataToFile } from "./utils"

const connection = new Connection(RPC, { wsEndpoint: WSS })
const wallets: string[] = []
const botWallets = readJson("bots.json")
const tokenMint = new PublicKey(MINT)
const mainKp = Keypair.fromSecretKey(base58.decode(MAIN_KP))

let ixs: TransactionInstruction[] = []
let baseVault: string = ""

const runListener = async () => {

  console.log("Wallet balance : ", await connection.getBalance(mainKp.publicKey))
  console.log("Wallet address : ", mainKp.publicKey.toBase58())

  const raydiumSubscriptionId = connection.onProgramAccountChange(
    MAINNET_PROGRAM_ID.AmmV4,
    async (updatedAccountInfo) => {
      const key = updatedAccountInfo.accountId.toString()
      const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data)
      const baseMint = poolState.baseMint
      baseVault = poolState.baseVault.toBase58()

      if (baseMint.toBase58() == MINT) {
        const quoteVault = poolState.quoteVault
        console.log("sdfdfdf: ", poolState.baseVault.toBase58())
        // poolIds.push(key)
        console.log("Pool created, pool id : ", key)
        connection.removeProgramAccountChangeListener(raydiumSubscriptionId)
        trackWallets(connection, quoteVault)
      }
    },
    COMMITMENT_LEVEL,
    [
      { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
          bytes: NATIVE_MINT.toBase58(),
        },
      },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
          bytes: MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58(),
        },
      },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
          bytes: base58.encode([6, 0, 0, 0, 0, 0, 0, 0]),
        },
      },
    ],
  )

  console.log('----------------------------------------')
  console.log('Bot is listening for buying wallets')
  console.log('----------------------------------------')
}

async function trackWallets(connection: Connection, quoteVault: PublicKey): Promise<void> {
  const solBal = await connection.getBalance(quoteVault) / 10 ** 9
  console.log("Vault has ", solBal, "SOL")

  try {
    connection.onLogs(
      quoteVault,
      async ({ logs, err, signature }) => {
        if (err) { }
        else {
          try {
            const parsedData = await connection.getParsedTransaction(signature,
              {
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed"
              }
            )
            const signer = parsedData?.transaction.message.accountKeys.filter((elem: any) => {
              return elem.signer == true
            })[0].pubkey.toBase58()

            if (signer != null && !botWallets.includes(signer) && mainKp.publicKey.toBase58() != signer) {
              const bal = await connection.getBalance(new PublicKey(signer))
              if (bal > 0) {
                console.log(`\User Transaction: https://solscan.io/tx/${signature}\n`)
                saveDataToFile([signer])
                const ata = await getAssociatedTokenAddress(tokenMint, new PublicKey(signer))

                let index = 0
                while (true) {
                  try {
                    if (index > 4) break
                    const transaction = new Transaction().add(
                      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
                      ComputeBudgetProgram.setComputeUnitLimit({ units: 13_000 }),
                      createFreezeAccountInstruction(ata, tokenMint, mainKp.publicKey)
                    );
                    const sig = await sendAndConfirmTransaction(connection, transaction, [mainKp], { skipPreflight: true });
                    console.log(`============>>>>>   Successfully freezed: https://solscan.io/tx/${sig}`)
                    break
                  } catch (error) {
                    index++
                  }
                }
              }
            }
          } catch (error) { }
        }
      },
      "confirmed"
    );

    // setInterval(() => {
    //   freezeByAta()
    // }, DOUBLE_CHECK_INTERVAL)

  } catch (error) {
    console.log("error:", error)
  }
}

const freezeByAta = async () => {
  try {
    const filters = [
      { dataSize: 165 },
      { memcmp: { offset: 0, bytes: tokenMint.toBase58() } }
    ];

    const holders = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
      encoding: "base64",
      filters
    });

    // holders.map((holder: any) => {
    //   console.log("ata :", holder.pubkey.toBase58(), SPL_ACCOUNT_LAYOUT.decode(holder.account.data).state)
    // })
    console.log(botWallets)

    const atasToFreeze = holders.map((holder: any) => ({ ataAddress: holder.pubkey, ...SPL_ACCOUNT_LAYOUT.decode(holder.account.data) }))
      .filter(data => data.state == 1 && !botWallets.includes(data.owner.toBase58()) && data.owner.toBase58() != baseVault && data.owner.toBase58() != mainKp.publicKey.toBase58())

    atasToFreeze.map((ata, i) => {
      setTimeout(() => {
        try {
          const transaction = new Transaction().add(
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
            ComputeBudgetProgram.setComputeUnitLimit({ units: 13_000 }),
            createFreezeAccountInstruction(ata.ataAddress, tokenMint, mainKp.publicKey)
          )
          sendAndConfirmTransaction(connection, transaction, [mainKp], { skipPreflight: true })
            .then(sig => console.log(`============>>>>>   Successfully freezed: https://solscan.io/tx/${sig}`))
        } catch (error) { console.log("double check tx failed") }
      }, i * 100)
    })
  } catch (error) {
    console.log("error in catching atas")
  }
}



const freezeWithSig = async () => {
  // if(!baseVault)
    // return
  const txList = await connection.getSignaturesForAddress(new PublicKey("8adayGtFQeCUWsz55JivCQxy5Q3boVLPJeTAr8HBNhUg"))
  const txs = txList.filter(tx => !tx.err).map(async (tx) => {
    const parsedData = await connection.getParsedTransaction(tx.signature, {commitment: "confirmed", maxSupportedTransactionVersion: 0})
    return parsedData
  })
  console.log("🚀 ~ freezeWithSig ~ txs:", txs)
}

// if you want to test freezing for some account, you can run test function
const test = async () => {
  const ata = await getAssociatedTokenAddress(tokenMint, new PublicKey("")) // input public key here to freeze account
  ixs.push(createFreezeAccountInstruction(ata, tokenMint, mainKp.publicKey))
  const transaction = new Transaction().add(...ixs);
  const sig = await sendAndConfirmTransaction(connection, transaction, [mainKp]);
  console.log(`https://solscan.io/tx/${sig}`)
}

// test()

// freezeByAta().then(() => console.log("let me know"))     // if you want to freeze after some time, you can run this function

// runListener()
freezeWithSig()