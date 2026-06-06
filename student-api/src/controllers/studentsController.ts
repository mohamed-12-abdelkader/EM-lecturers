class StudentsController {
  private students: Array<{ name: string; phone: string; guardianPhone: string; class: string }> = [
    { name: 'Ali Ahmed', phone: '1234567890', guardianPhone: '0987654321', class: '5A' },
    { name: 'Sara Mohamed', phone: '2345678901', guardianPhone: '9876543210', class: '5B' },
    { name: 'Omar Khaled', phone: '3456789012', guardianPhone: '8765432109', class: '6A' },
  ];

  public getAllStudents(req: any, res: any): void {
    res.json(this.students);
  }
}

export default StudentsController;
