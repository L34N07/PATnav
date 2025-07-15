import React, { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)

  return (
    <div style={{ padding: 20 }}>
      <h1>PATnav UI</h1>
      <p>Counter: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  )
}
