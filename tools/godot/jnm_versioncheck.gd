extends Node
## Contrôle de version de release.ps1, injecté en autoload par un override.cfg temporaire.
## Lancé sans fenêtre (--headless) : parcourt les textes visibles de l'écran titre et vérifie
## que la version attendue (JNM_VERSION_CHECK) y figure, et qu'aucune autre version n'est affichée.
## Inerte sans JNM_VERSION_CHECK. Imprime une ligne « JNM_VERSION … » puis quitte.

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


func _text_of(c: Control) -> String:
	if c is RichTextLabel:
		return (c as RichTextLabel).get_parsed_text()
	if c is Label or c is Button or c is LineEdit:
		return String(c.get("text"))
	return ""


func _scan() -> String:
	var label: Control = null
	var texts: Array[Control] = []
	var stack: Array[Node] = [get_tree().root]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		stack.append_array(n.get_children())
		if not (n is Control) or not (n as Control).is_visible_in_tree():
			continue
		var c := n as Control
		var txt := _text_of(c).strip_edges()
		if txt.is_empty():
			continue
		texts.append(c)
		for m in re.search_all(txt):
			if m.get_string(1) != expected:
				return "STALE|%s" % txt.replace("\n", " ")
		if label == null and txt.contains(expected):
			label = c
	if label == null:
		return ""
	var r := label.get_global_rect()
	# un autre texte du même écran qui chevauche la version (bouton, crédits…)
	var overlap := ""
	for o in texts:
		if o != label and o.get_viewport() == label.get_viewport() and not o.is_ancestor_of(label) \
				and not label.is_ancestor_of(o) and o.get_global_rect().grow(-1).intersects(r.grow(-1)):
			overlap = _text_of(o).strip_edges().replace("\n", " ").left(40)
			break
	return "OK|%s|%d|%d|%s" % [_text_of(label).strip_edges().replace("\n", " "), int(r.end.y),
			int(label.get_viewport_rect().size.y), overlap]
