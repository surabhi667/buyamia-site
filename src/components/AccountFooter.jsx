import { footerLinkGroups } from '../footerLinks'

export default function AccountFooter({ className = '', extras = {} }) {
  return (
    <footer className={`account-footer${className ? ` ${className}` : ''}`}>
      <a className="logo" href="/">buyamia</a>
      <p>Buy some comfort. Buy<br />some care.</p>
      {footerLinkGroups.map((group) => (
        <div key={group.title}>
          <small>{group.title}</small>
          {group.links.map((link) => <a href={link.href} key={link.label}>{link.label}</a>)}
          {(extras[group.title] || []).map((link) => <a href={link.href} key={link.label}>{link.label}</a>)}
        </div>
      ))}
    </footer>
  )
}
