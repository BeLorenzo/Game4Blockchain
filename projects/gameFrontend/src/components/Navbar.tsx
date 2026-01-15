import { useWallet } from '@txnlab/use-wallet-react'

export const Navbar = () => {
  const { activeAddress, wallets } = useWallet()

  const truncate = (str: string) => `${str.slice(0, 4)}...${str.slice(-4)}`

  return (
    <div className="navbar bg-base-100 shadow-lg px-4 sticky top-0 z-50">
      <div className="flex-1">
        <a className="btn btn-ghost normal-case text-xl text-primary font-bold">Game4Blockchain 🎮</a>
      </div>
      <div className="flex-none">
        {activeAddress ? (
          <div className="dropdown dropdown-end">
            <label tabIndex={0} className="btn btn-outline btn-success btn-sm m-1 font-mono">
              {truncate(activeAddress)}
            </label>
            <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-200 rounded-box w-52">
              <li className="menu-title">
                <span>Connesso con</span>
              </li>
              {wallets
                ?.filter((w) => w.isActive)
                .map((w) => (
                  <li key={w.id}>
                    <a className="active">{w.metadata.name}</a>
                  </li>
                ))}
              <div className="divider my-0"></div>
              <li>
                <a onClick={() => wallets?.find((w) => w.isActive)?.disconnect()} className="text-error">
                  Disconnetti
                </a>
              </li>
            </ul>
          </div>
        ) : (
          <div className="dropdown dropdown-end">
            <label tabIndex={0} className="btn btn-primary btn-sm m-1">
              Connetti Wallet
            </label>
            <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-200 rounded-box w-52">
              {wallets?.map((wallet) => (
                <li key={wallet.id}>
                  <a onClick={() => wallet.connect()}>
                    <img src={wallet.metadata.icon} alt={wallet.metadata.name} className="w-5 h-5" />
                    {wallet.metadata.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
