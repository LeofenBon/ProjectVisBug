import $ from 'blingblingjs'
import hotkeys from 'hotkeys-js'

import { canMoveLeft, canMoveRight, canMoveUp } from './move'
import { watchImagesForUpload } from './imageswap'
import { queryPage } from './search'
import { createMeasurements, clearMeasurements } from './measurements'
import { showTip as showMetaTip, removeAll as removeAllMetaTips } from './metatip'
import { showTip as showAccessibilityTip, removeAll as removeAllAccessibilityTips } from './accessibility'

import { 
  metaKey, htmlStringToDom, createClassname, 
  isOffBounds, getStyles, deepElementFromPoint 
} from '../utilities/'

export function Selectable() {
  const elements          = $('body')
  let selected            = []
  let selectedCallbacks   = []
  let labels              = []
  let hovers              = []
  let handles             = []

  const listen = () => {
    elements.forEach(el => el.addEventListener('click', on_click, true))
    elements.forEach(el => el.addEventListener('dblclick', on_dblclick, true))

    elements.on('selectstart', on_selection)
    elements.on('mousemove', on_hover)
    elements.on('mouseout', on_hoverout)

    document.addEventListener('copy', on_copy)
    document.addEventListener('cut', on_cut)
    document.addEventListener('paste', on_paste)

    watchCommandKey()

    hotkeys(`${metaKey}+alt+c`, on_copy_styles)
    hotkeys(`${metaKey}+alt+v`, e => on_paste_styles())
    hotkeys('esc', on_esc)
    hotkeys(`${metaKey}+d`, on_duplicate)
    hotkeys('backspace,del,delete', on_delete)
    hotkeys('alt+del,alt+backspace', on_clearstyles)
    hotkeys(`${metaKey}+e,${metaKey}+shift+e`, on_expand_selection)
    hotkeys(`${metaKey}+g,${metaKey}+shift+g`, on_group)
    hotkeys('tab,shift+tab,enter,shift+enter', on_keyboard_traversal)
    hotkeys(`${metaKey}+shift+enter`, on_select_children)
  }

  const unlisten = () => {
    elements.forEach(el => el.removeEventListener('click', on_click, true))
    elements.forEach(el => el.removeEventListener('dblclick', on_dblclick, true))

    elements.off('selectstart', on_selection)
    elements.off('mousemove', on_hover)
    elements.off('mouseout', on_hoverout)

    document.removeEventListener('copy', on_copy)
    document.removeEventListener('cut', on_cut)
    document.removeEventListener('paste', on_paste)

    hotkeys.unbind(`esc,${metaKey}+d,backspace,del,delete,alt+del,alt+backspace,${metaKey}+e,${metaKey}+shift+e,${metaKey}+g,${metaKey}+shift+g,tab,shift+tab,enter,shift+enter`)
  }

  const on_click = e => {
    const $target = deepElementFromPoint(e.clientX, e.clientY)

    if (isOffBounds($target) && !selected.filter(el => el == $target).length)
      return

    e.preventDefault()
    if (!e.altKey) e.stopPropagation()
    if (!e.shiftKey) unselect_all()

    if(e.shiftKey && $target.hasAttribute('data-label-id'))
      unselect($target.getAttribute('data-label-id'))
    else
      select($target)
  }

  const unselect = id => {
    [...labels, ...handles, ...hovers]
      .filter(node =>
          node.getAttribute('data-label-id') === id)
        .forEach(node =>
          node.remove())

    selected.filter(node =>
      node.getAttribute('data-label-id') === id)
      .forEach(node =>
        $(node).attr({
          'data-selected':      null,
          'data-selected-hide': null,
          'data-label-id':      null,
          'data-hover':         null,
          'data-measuring':     null,
      }))

    selected = selected.filter(node => node.getAttribute('data-label-id') !== id)

    tellWatchers()
  }

  const on_dblclick = e => {
    e.preventDefault()
    e.stopPropagation()
    if (isOffBounds(e.target)) return
    $('tool-pallete')[0].toolSelected('text')
  }

  const watchCommandKey = e => {
    let did_hide = false

    document.onkeydown = function(e) {
      if (hotkeys.ctrl && selected.length) {
        $('pb-handles, pb-label, pb-hovers').forEach(el =>
          el.style.display = 'none')

        did_hide = true
      }
    }

    document.onkeyup = function(e) {
      if (did_hide) {
        $('pb-handles, pb-label, pb-hovers').forEach(el =>
          el.style.display = null)

        did_hide = false
      }
    }
  }

  const on_esc = _ =>
    selected.length && unselect_all()

  const on_duplicate = e => {
    const root_node = selected[0]
    if (!root_node) return

    const deep_clone = root_node.cloneNode(true)
    deep_clone.removeAttribute('data-selected')
    root_node.parentNode.insertBefore(deep_clone, root_node.nextSibling)
    e.preventDefault()
  }

  const on_delete = e =>
    selected.length && delete_all()

  const on_clearstyles = e =>
    selected.forEach(el =>
      el.attr('style', null))

  const on_copy = e => {
    // if user has selected text, dont try to copy an element
    if (window.getSelection().toString().length)
      return

    if (selected[0] && this.node_clipboard !== selected[0]) {
      e.preventDefault()
      let $node = selected[0].cloneNode(true)
      $node.removeAttribute('data-selected')
      this.copy_backup = $node.outerHTML
      e.clipboardData.setData('text/html', this.copy_backup)
    }
  }

  const on_cut = e => {
    if (selected[0] && this.node_clipboard !== selected[0]) {
      let $node = selected[0].cloneNode(true)
      $node.removeAttribute('data-selected')
      this.copy_backup = $node.outerHTML
      e.clipboardData.setData('text/html', this.copy_backup)
      selected[0].remove()
    }
  }

  const on_paste = e => {
    const clipData = e.clipboardData.getData('text/html')
    const potentialHTML = clipData || this.copy_backup
    if (selected[0] && potentialHTML) {
      e.preventDefault()
      selected[0].appendChild(
        htmlStringToDom(potentialHTML))
    }
  }

  const on_copy_styles = e => {
    e.preventDefault()
    this.copied_styles = selected.map(el =>
      getStyles(el))
  }

  const on_paste_styles = (index = 0) =>
    selected.forEach(el => {
      this.copied_styles[index]
        .map(({prop, value}) =>
          el.style[prop] = value)

      index >= this.copied_styles.length - 1
        ? index = 0
        : index++
    })

  const on_expand_selection = (e, {key}) => {
    e.preventDefault()

    expandSelection({
      query:  combineNodeNameAndClass(selected[0]),
      all:    key.includes('shift'),
    })
  }

  const on_group = (e, {key}) => {
    e.preventDefault()

    if (key.split('+').includes('shift')) {
      let $selected = [...selected]
      unselect_all()
      $selected.reverse().forEach(el => {
        let l = el.children.length
        while (el.children.length > 0) {
          var node = el.childNodes[el.children.length - 1]
          if (node.nodeName !== '#text')
            select(node)
          el.parentNode.prepend(node)
        }
        el.parentNode.removeChild(el)
      })
    }
    else {
      let div = document.createElement('div')
      selected[0].parentNode.prepend(
        selected.reverse().reduce((div, el) => {
          div.appendChild(el)
          return div
        }, div)
      )
      unselect_all()
      select(div)
    }
  }

  const on_selection = e =>
    !isOffBounds(e.target)
    && selected.length
    && selected[0].textContent != e.target.textContent
    && e.preventDefault()

  const on_keyboard_traversal = (e, {key}) => {
    if (!selected.length) return

    e.preventDefault()
    e.stopPropagation()

    const targets = selected.reduce((flat, node) => {
      const element_to_left     = canMoveLeft(node)
      const element_to_right    = canMoveRight(node)
      const has_parent_element  = canMoveUp(node)
      const has_child_elements  = node.children.length

      if (key.includes('shift')) {
        if (key.includes('tab') && element_to_left)
          flat.push(element_to_left)
        else if (key.includes('enter') && has_parent_element)
          flat.push(node.parentNode)
        else
          flat.push(node)
      }
      else {
        if (key.includes('tab') && element_to_right)
          flat.push(element_to_right)
        else if (key.includes('enter') && has_child_elements)
          flat.push(node.children[0])
        else
          flat.push(node)
      }

      return flat
    }, [])

    if (targets.length) {
      unselect_all()
      targets.forEach(node => {
        select(node)
        show_tip(node)
      })
    }
  }

  const show_tip = el => {
    const active_tool = $('tool-pallete')[0].activeTool
    let tipFactory

    if (active_tool === 'accessibility') {
      removeAllAccessibilityTips()
      tipFactory = showAccessibilityTip
    }
    else if (active_tool === 'inspector') {
      removeAllMetaTips()
      tipFactory = showMetaTip
    }

    if (!tipFactory) return

    const {top, left} = el.getBoundingClientRect()
    const { pageYOffset, pageXOffset } = window

    tipFactory(el, {
      clientY:  top,
      clientX:  left,
      pageY:    pageYOffset + top - 10,
      pageX:    pageXOffset + left + 20,
    })
  }

  const on_hover = e => {
    const $target = deepElementFromPoint(e.clientX, e.clientY)
    if (isOffBounds($target)) return

    overlayHoverUI($target)

    if (e.altKey && $('tool-pallete')[0].activeTool === 'guides' && selected.length === 1 && selected[0] != $target) {
      $target.setAttribute('data-measuring', true)
      const [$anchor] = selected
      return createMeasurements({$anchor, $target})
    }
    else if ($target.hasAttribute('data-measuring')) {
      $target.removeAttribute('data-measuring')
      clearMeasurements()
    }

    $target.setAttribute('data-hover', true)
  }

  const on_hoverout = ({target}) => {
    $(target).attr({
      'data-hover':     null,
      'data-measuring': null,
    })
    clearMeasurements()
  }

  const select = el => {
    el.setAttribute('data-selected', true)
    overlayMetaUI(el)
    selected.unshift(el)
    tellWatchers()
  }

  const selection = () => 
    selected

  const unselect_all = () => {
    selected
      .forEach(el =>
        $(el).attr({
          'data-selected':      null,
          'data-selected-hide': null,
          'data-label-id':      null,
          'data-hover':         null,
        }))

    Array.from([...handles, ...labels, ...hovers]).forEach(el =>
      el.remove())

    labels    = []
    handles   = []
    hovers    = []
    selected  = []
  }

  const delete_all = () => {
    const selected_after_delete = selected.map(el => {
      if (canMoveRight(el))     return canMoveRight(el)
      else if (canMoveLeft(el)) return canMoveLeft(el)
      else if (el.parentNode)   return el.parentNode
    })

    Array.from([...selected, ...labels, ...handles, ...hovers]).forEach(el =>
      el.remove())

    labels    = []
    hovers    = []
    handles   = []
    selected  = []

    selected_after_delete.forEach(el =>
      select(el))
  }

  const expandSelection = ({query, all = false}) => {
    if (all) {
      const unselecteds = $(query + ':not([data-selected])')
      unselecteds.forEach(select)
    }
    else {
      const potentials = $(query)
      if (!potentials) return

      const root_node_index = potentials.reduce((index, node, i) =>
        combineNodeNameAndClass(node) == query
          ? index = i
          : index
      , null)

      if (root_node_index !== null) {
        if (!potentials[root_node_index + 1]) {
          const potential = potentials.filter(el => !el.attr('data-selected'))[0]
          if (potential) select(potential)
        }
        else {
          select(potentials[root_node_index + 1])
        }
      }
    }
  }

  const combineNodeNameAndClass = node =>
    `${node.nodeName.toLowerCase()}${createClassname(node)}`

  const overlayHoverUI = el => {
    let hover = createHover(el)

    $(el).on('mouseout', e =>{
      hover && hover.remove()
      e.target.removeEventListener(e.type, arguments.callee)
    })
  }

  const overlayMetaUI = el => {
    let handle = createHandle(el)
    let label  = createLabel(el, `
      <a>${el.nodeName.toLowerCase()}</a>
      <a>${el.id && '#' + el.id}</a>
      ${createClassname(el).split('.')
        .filter(name => name != '')
        .reduce((links, name) => `
          ${links}
          <a>.${name}</a>
        `, '')
      }
    `)

    let observer        = createObserver(el, {handle,label})
    let parentObserver  = createObserver(el, {handle,label})

    observer.observe(el, { attributes: true })
    parentObserver.observe(el.parentNode, { childList:true, subtree:true })

    $(label).on('DOMNodeRemoved', _ => {
      observer.disconnect()
      parentObserver.disconnect()
    })
  }

  const setLabel = (el, label) =>
    label.update = el.getBoundingClientRect()

  const createLabel = (el, text) => {
    if (!labels[parseInt(el.getAttribute('data-label-id'))]) {
      const label = document.createElement('pb-label')

      label.text = text
      label.position = {
        boundingRect:   el.getBoundingClientRect(),
        node_label_id:  labels.length,
      }
      el.setAttribute('data-label-id', labels.length)

      document.body.appendChild(label)

      $(label).on('query', ({detail}) => {
        if (!detail.text) return
        this.query_text = detail.text

        queryPage('[data-hover]', el =>
          el.setAttribute('data-hover', null))

        queryPage(this.query_text + ':not([data-selected])', el =>
          detail.activator === 'mouseenter'
            ? el.setAttribute('data-hover', true)
            : select(el))
      })

      $(label).on('mouseleave', e => {
        e.preventDefault()
        e.stopPropagation()
        queryPage('[data-hover]', el =>
          el.setAttribute('data-hover', null))
      })

      labels[labels.length] = label
      return label
    }
  }

  const createHandle = el => {
    if (!handles[parseInt(el.getAttribute('data-label-id'))]) {
      const handle = document.createElement('pb-handles')

      handle.position = {
        boundingRect:   el.getBoundingClientRect(),
        node_label_id:  handles.length,
      }

      document.body.appendChild(handle)

      handles[handles.length] = handle
      return handle
    }
  }

  const createHover = el => {
    if (!hovers[parseInt(el.getAttribute('data-label-id'))]) {
      const hover = document.createElement('pb-hovers')

      hover.position = {
        boundingRect:   el.getBoundingClientRect(),
        node_label_id:  hovers.length,
      }

      document.body.appendChild(hover)

      hovers[hovers.length] = hover
      return hover
    }
  }

  const setHandle = (node, handle) => {
    handle.position = {
      boundingRect:   node.getBoundingClientRect(),
      node_label_id:  node.getAttribute('data-label-id'),
    }
  }

  const createObserver = (node, {label,handle}) =>
    new MutationObserver(list => {
      setLabel(node, label)
      setHandle(node, handle)
    })

  const onSelectedUpdate = (cb, immediateCallback = true) => {
    selectedCallbacks.push(cb)
    if (immediateCallback) cb(selected)
  }

  const removeSelectedCallback = cb =>
    selectedCallbacks = selectedCallbacks.filter(callback => callback != cb)

  const tellWatchers = () =>
    selectedCallbacks.forEach(cb => cb(selected))

  const disconnect = () => {
    unselect_all()
    unlisten()
  }

  const on_select_children = (e, {key}) => {
    const targets = selected
      .filter(node => node.children.length)
      .reduce((flat, {children}) => 
        [...flat, ...Array.from(children)], [])
    
    if (targets.length) {
      e.preventDefault()
      e.stopPropagation()
      
      unselect_all()
      targets.forEach(node => select(node))
    }
  }

  watchImagesForUpload()
  listen()

  return {
    select,
    selection,
    unselect_all,
    onSelectedUpdate,
    removeSelectedCallback,
    disconnect,
  }
}
