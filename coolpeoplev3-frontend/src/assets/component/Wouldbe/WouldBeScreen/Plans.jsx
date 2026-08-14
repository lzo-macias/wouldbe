import React, {useState, useEffect} from 'react'
import api from '../../../lib/api';
import "./Plans.css"

function EditableFields({component, onSaved}) {
  const [editable, setEditable] = useState(false)
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // SEED the state from the component instead of using the existing text as a
  // placeholder. A placeholder only LOOKS pre-filled: the field is actually empty,
  // so editing one word replaces the whole description, and hitting Save without
  // typing submits "" (which the API rejects with a confusing 400).
  function startEdit() {
    setDescription(component.description ?? "")
    setError(null)
    setEditable(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    // PATCH uses COALESCE, but '' is a value not null — an empty box would blank
    // the position rather than leave it alone.
    if (!description.trim()) return setError("Write something, or cancel")
    setSaving(true)
    setError(null)
    try {
      // component.id directly — the separate componentId state was a second copy
      // of something already in scope, and one more thing to get out of sync.
      const { data } = await api.patch(`/api/plan-components/${component.id}`, {
        description: description.trim(),
      })
      onSaved?.(data)          // lift it up so the new text shows without a refetch
      setEditable(false)
    } catch (err) {
      console.error("[Plans] save failed", err)
      setError(err.response?.data?.error || "Could not save that change")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='planRail'>
      <span className='horizantal'></span>
      <div className='editablefieldscontainer'>
        <div className='Plantitle'>
          <span className='PolicyTag'>Policy</span>
          <span>{component.title}</span>
        </div>
        <div className='planDescription'>
          {editable ? (
            // <form> so Enter submits and the button doesn't need its own handler
            <form className='planDescriptionForm' onSubmit={handleSubmit}>
              {/* textarea, NOT <input type="text">. A single-line input can't wrap,
                  so a 200px-tall box showed one clipped line floating in the middle —
                  and an input takes its width from the `size` attribute, which is why
                  the edit box collapsed to a square next to the full-width <p>. */}
              <textarea
                className='editabledescription'
                id={`desc-${component.id}`}
                placeholder='Write your plan here'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className='planDescriptionActions'>
                {error && <span className='planDescriptionError'>{error}</span>}
                <button className = "cancel" type='button' onClick={() => setEditable(false)} disabled={saving}>Cancel</button>
                <button className = "save" type='submit' disabled={saving}>{saving ? "Saving…" : "Save"}</button>
              </div>
            </form>
          ) : (
            <>
              <p className='noneditabledescription'>{component.description}</p>
              <button type='button' onClick={startEdit}>Edit</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Plans({plans}) {
  const [components, setComponents] = useState([])
  //render plans components, title, description
  //if user_id is null or doesnt match plans.user_id edit buttons && add/delete not visible, when edit button clicked save footer renders
  //if edit button clicked can edit text for plan component_title
  
  useEffect(() => {
    setComponents(plans?.flatMap(p => p.components ?? []) ?? [])
  }, [plans])

  // Merge the saved row back in, so the edited text renders immediately instead
  // of only after a refetch.
  function handleSaved(updated) {
    setComponents(prev => prev.map(c => (c.id === updated.id ? { ...c, ...updated } : c)))
  }

  return (
    <div className='planBigContainer'>
      {components.map((component) => (
        <EditableFields key={component.id} component={component} onSaved={handleSaved} />
      ))}
    </div>
  )
}

export default Plans