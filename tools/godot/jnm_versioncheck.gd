extends Node
## Contrôle de version de release.ps1, injecté en autoload par un override.cfg temporaire.
## Lancé sans fenêtre (--headless) : parcourt les textes visibles de l'écran titre et vérifie
## que la version attendue (JNM_VERSION_CHECK) y figure, et qu'aucune autre version n'est affichée.
## Inerte sans JNM_VERSION_CHECK. Imprime une ligne « JNM_VERSION … » puis quitte.
##
## Textes lus : Label, RichTextLabel, Button, LineEdit, et tout CanvasItem qui dessine son texte
## lui-même et le déclare avec set_meta("jnm_text", texte) + set_meta("jnm_rect", Rect2 local).

const TIMEOUT_MS := 15000
const SCAN_EVERY_MS := 500

var expected := ""
var started := 0
var next_scan := 0
var re := RegEx.new()


func _ready() -> void:
	expected = OS.get_environment("JNM_VERSION_CHECK")
	if expected.is_empty():
		queue_free()
		return
	process_mode = Node.PROCESS_MODE_ALWAYS
	# Sans fenêtre, la racine fait 64×64 : on lui donne la taille du projet pour que la mise en page soit la vraie.
	get_tree().root.size = Vector2i(
		int(ProjectSettings.get_setting("display/window/size/viewport_width", 1152)),
		int(ProjectSettings.get_setting("display/window/size/viewport_height", 648)))
	# « v0.007 », « V 1.2.3 », « version 0.007 » : tout ce qui ressemble à un numéro de version affiché
	re.compile("(?i)(?:\\bv|version)\\s?(\\d+\\.\\d+(?:\\.\\d+)?)\\b")
	started = Time.get_ticks_msec()
	next_scan = started + 1000   # laisse l'écran titre se construire


func _process(_delta: float) -> void:
	var now := Time.get_ticks_msec()
	if now < next_scan:
		return
	next_scan = now + SCAN_EVERY_MS
	var verdict := _scan()
	if verdict.is_empty() and now - started < TIMEOUT_MS:
		return
	print("JNM_VERSION ", verdict if not verdict.is_empty() else "MISSING")
	get_tree().quit()


## Texte visible d'un nœud et son rectangle à l'écran, ou {} s'il n'en affiche pas.
func _text_of(n: Node) -> Dictionary:
	if not (n is CanvasItem) or not (n as CanvasItem).is_visible_in_tree():
		return {}
	var ci := n as CanvasItem
	if ci.has_meta("jnm_text"):
		var r: Rect2 = ci.get_meta("jnm_rect", Rect2())
		return {"text": String(ci.get_meta("jnm_text")), "rect": ci.get_global_transform() * r}
	if not (n is Control):
		return {}
	var c := n as Control
	var txt := ""
	if c is RichTextLabel:
		txt = (c as RichTextLabel).get_parsed_text()
	elif c is Label or c is Button or c is LineEdit:
		txt = String(c.get("text"))
	return {"text": txt, "rect": c.get_global_rect()} if not txt.strip_edges().is_empty() else {}


func _scan() -> String:
	var label := {}
	var texts: Array[Dictionary] = []
	var stack: Array[Node] = [get_tree().root]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		stack.append_array(n.get_children())
		var t := _text_of(n)
		if t.is_empty():
			continue
		t["node"] = n
		t["text"] = String(t["text"]).strip_edges().replace("\n", " ")
		texts.append(t)
		for m in re.search_all(t["text"]):
			if m.get_string(1) != expected:
				return "STALE|%s" % t["text"]
		if label.is_empty() and String(t["text"]).contains(expected):
			label = t
	if label.is_empty():
		return ""
	var node: CanvasItem = label["node"]
	var r: Rect2 = label["rect"]
	# un autre texte du même écran qui chevauche la version (bouton, crédits…)
	var overlap := ""
	for o in texts:
		var on: CanvasItem = o["node"]
		if on == node or on.get_viewport() != node.get_viewport() or on.is_ancestor_of(node) or node.is_ancestor_of(on):
			continue
		if (o["rect"] as Rect2).grow(-1).intersects(r.grow(-1)):
			overlap = String(o["text"]).left(40)
			break
	return "OK|%s|%d|%d|%s" % [label["text"], int(r.end.y), int(node.get_viewport_rect().size.y), overlap]
