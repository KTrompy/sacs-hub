import { Component } from 'react'

// Catches render errors anywhere below it in the tree. Without this,
// main.jsx had nothing standing between an unhandled render error and a
// fully white screen — React unmounts the whole tree on an uncaught error
// during render, and there was no boundary to stop that from propagating
// all the way up to the app root.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled render error:', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback">
          <div className="panel narrow" style={{ textAlign: 'center', margin: '80px auto' }}>
            <h2 className="panel-title">Something went wrong</h2>
            <p className="panel-sub">
              This page hit an unexpected error. Reloading usually fixes it — your data is safe.
            </p>
            <button type="button" className="btn primary" onClick={this.handleReload} style={{ marginTop: 16 }}>
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
